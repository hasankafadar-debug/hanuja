import type { Prisma, PrismaClient } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import type { NotificationDispatchJobData } from '../jobs/notification-dispatch.job'
import { notificationLane } from '../lib/notification-policy'

type OutboxClient = Pick<Prisma.TransactionClient, 'notificationOutbox'>

/** Pass the domain transaction client to atomically persist the event and business change.
 * Never contact Redis or SMTP here. Legacy producers are durable from this call onward;
 * their business-transaction wiring is migrated with each event in phase 2 onward.
 */
export async function recordNotification(
  tx: OutboxClient,
  payload: NotificationDispatchJobData,
) {
  const eventKey = payload.eventKey ?? `notification:${randomUUID()}`
  const type = payload.type
  return tx.notificationOutbox.upsert({
    where: { userId_type_eventKey: { userId: payload.userId, type, eventKey } },
    update: {},
    create: {
      eventKey,
      userId: payload.userId,
      type,
      lane: notificationLane(type),
      payload: JSON.parse(
        JSON.stringify({ ...payload, eventKey }),
      ) as Prisma.InputJsonValue,
    },
  })
}

/**
 * Batch form of `recordNotification` for fan-out producers. `skipDuplicates` keeps the
 * same meaning as the single-row `upsert(update: {})`: an existing
 * `(userId, type, eventKey)` row is left untouched. Every payload needs its own eventKey.
 */
export async function recordNotifications(
  tx: OutboxClient,
  payloads: readonly NotificationDispatchJobData[],
) {
  if (!payloads.length) return { count: 0 }
  return tx.notificationOutbox.createMany({
    data: payloads.map((payload) => {
      if (!payload.eventKey) throw new Error('NOTIFICATION_EVENT_KEY_REQUIRED')
      return {
        eventKey: payload.eventKey,
        userId: payload.userId,
        type: payload.type,
        lane: notificationLane(payload.type),
        payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      }
    }),
    skipDuplicates: true,
  })
}

export function outboxJobId(id: string, generation: number) {
  return createHash('sha256').update(`${id}|${generation}`).digest('hex')
}

export async function relayNotifications(prisma: PrismaClient) {
  const { notificationDispatchQueue, notificationBulkQueue } =
    await import('../lib/queue')
  const batches = await Promise.all(
    ['transactional', 'bulk'].map((lane) =>
      prisma.notificationOutbox.findMany({
        where: {
          lane,
          OR: [
            { status: 'pending' },
            {
              status: 'queued',
              queuedAt: { lt: new Date(Date.now() - 15 * 60_000) },
            },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      }),
    ),
  )
  const rows = batches.flat()
  for (const row of rows) {
    const queue =
      row.lane === 'bulk' ? notificationBulkQueue : notificationDispatchQueue
    const jobId = outboxJobId(row.id, row.generation)
    try {
      const existing = await queue.getJob(jobId)
      const state = await existing?.getState()
      if (state === 'failed' || state === 'completed') {
        await prisma.notificationOutbox.updateMany({
          where: {
            id: row.id,
            generation: row.generation,
            status: { in: ['pending', 'queued'] },
          },
          data: {
            status: state === 'completed' ? 'completed' : 'failed',
            lastError: state === 'failed' ? 'QUEUE_ATTEMPTS_EXHAUSTED' : null,
          },
        })
        continue
      }
      if (!existing) {
        await queue.add(
          'notify',
          {
            ...(row.payload as unknown as NotificationDispatchJobData),
            outboxId: row.id,
            generation: row.generation,
          },
          {
            jobId,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 7 * 86400, count: 10000 },
            removeOnFail: { age: 30 * 86400, count: 10000 },
          },
        )
      }
      await prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          generation: row.generation,
          status: { in: ['pending', 'queued'] },
        },
        data: { status: 'queued', queuedAt: new Date(), lastError: null },
      })
    } catch {
      await prisma.notificationOutbox.updateMany({
        where: {
          id: row.id,
          generation: row.generation,
          status: { in: ['pending', 'queued'] },
        },
        data: { lastError: 'QUEUE_UNAVAILABLE' },
      })
      throw new Error('NOTIFICATION_QUEUE_UNAVAILABLE')
    }
  }
  // An SMTP attempt interrupted after DATA may already have been accepted.
  // Quarantine it rather than blindly sending again after its lease expires.
  await prisma.notificationDelivery.updateMany({
    where: {
      channel: 'email',
      status: 'processing',
      OR: [{ leaseExpiresAt: { lt: new Date() } }, { leaseExpiresAt: null }],
    },
    data: {
      status: 'failed',
      transportStatus: 'uncertain',
      lastError: 'SMTP_OUTCOME_UNCERTAIN',
      leaseToken: null,
    },
  })
}
