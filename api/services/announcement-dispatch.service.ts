/**
 * Announcement dispatch sweep (e-mail plan phase 5). Runs on its own queue so the
 * notification relay never waits for it.
 *
 * One tick is one short transaction. A transaction-scoped advisory lock makes it the
 * only announcement writer, so measuring the bulk lane's free capacity and filling
 * it cannot race another sweep. New recipients are written to the outbox first; bulk
 * retries requested by an admin are requeued with whatever capacity is left.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { recordNotifications } from './notification-outbox.service'
import { announcementPanelUrl } from './announcement-content'

/** Upper bound on pending+queued bulk-lane rows that announcement writes may fill up to. */
export const ANNOUNCEMENT_BULK_INFLIGHT_CAP = 100
const SWEEP_LOCK_NAME = 'hanuja:announcement-dispatch'
const SWEEP_TX_TIMEOUT_MS = 10_000
export const ANNOUNCEMENT_IN_APP_TITLE = 'Yeni duyuru'

type Tx = Prisma.TransactionClient

export type AnnouncementSweepResult = {
  skipped?: 'locked' | 'capacity'
  written: number
  requeued: number
  cleared: number
}

type FreshRecipientRow = {
  id: string
  announcementId: string
  userId: string
  sellerName: string
  eventKey: string
  sentTitle: string | null
}

type RetryRecipientRow = {
  id: string
  userId: string
  eventKey: string
  sellerId: string | null
}

/**
 * Same guards as the single-row admin retry: never after an uncertain SMTP outcome,
 * only a final failure, a new generation so BullMQ gets a fresh job id.
 */
async function requeueFailedAnnouncementDelivery(tx: Tx, row: RetryRecipientRow): Promise<boolean> {
  const uncertain = await tx.notificationDelivery.count({
    where: { eventKey: row.eventKey, channel: 'email', transportStatus: 'uncertain' },
  })
  if (uncertain) return false
  const failedDeliveries = await tx.notificationDelivery.count({
    where: {
      eventKey: row.eventKey,
      channel: 'email',
      status: 'failed',
      transportStatus: { not: 'uncertain' },
    },
  })
  const claimed = await tx.notificationOutbox.updateMany({
    where: {
      userId: row.userId,
      type: 'seller_announcement',
      eventKey: row.eventKey,
      status: { in: failedDeliveries ? ['failed', 'completed'] : ['failed'] },
    },
    data: { status: 'pending', generation: { increment: 1 }, queuedAt: null, lastError: null },
  })
  if (!claimed.count) return false
  await tx.notificationDelivery.updateMany({
    where: {
      eventKey: row.eventKey,
      channel: 'email',
      status: 'failed',
      transportStatus: { not: 'uncertain' },
    },
    data: { status: 'pending', lastError: null },
  })
  return true
}

export async function runAnnouncementDispatchSweep(
  prisma: PrismaClient,
  options: { cap?: number } = {},
): Promise<AnnouncementSweepResult> {
  const cap = options.cap ?? ANNOUNCEMENT_BULK_INFLIGHT_CAP
  return prisma.$transaction(
    async (tx) => {
      // Bounded: a slow database or a held row lock ends this tick instead of stalling it.
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`)
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5s'`)
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${SWEEP_LOCK_NAME})) AS locked`,
      )
      if (!lock?.locked) return { skipped: 'locked', written: 0, requeued: 0, cleared: 0 }

      const inFlight = await tx.notificationOutbox.count({
        where: { lane: 'bulk', status: { in: ['pending', 'queued'] } },
      })
      let room = cap - inFlight
      if (room <= 0) return { skipped: 'capacity', written: 0, requeued: 0, cleared: 0 }

      const fresh = await tx.$queryRaw<FreshRecipientRow[]>(Prisma.sql`
        SELECT r.id, r."announcementId", r."userId", r."sellerName", r."eventKey", a."sentTitle"
        FROM announcement_recipients r
        JOIN announcements a ON a.id = r."announcementId"
        WHERE r."outboxWrittenAt" IS NULL
          AND r."sellerId" IS NOT NULL
          AND a.status = 'sent'
        ORDER BY r."createdAt", r.id
        LIMIT ${room}
        FOR UPDATE OF r SKIP LOCKED
      `)
      if (fresh.length) {
        await recordNotifications(
          tx,
          fresh.map((row) => ({
            eventKey: row.eventKey,
            userId: row.userId,
            type: 'seller_announcement' as const,
            title: ANNOUNCEMENT_IN_APP_TITLE,
            body: row.sentTitle ?? ANNOUNCEMENT_IN_APP_TITLE,
            data: {
              announcementId: row.announcementId,
              sellerName: row.sellerName,
              panelUrl: announcementPanelUrl(row.announcementId),
            },
          })),
        )
        await tx.announcementRecipient.updateMany({
          where: { id: { in: fresh.map((row) => row.id) } },
          data: { outboxWrittenAt: new Date() },
        })
        room -= fresh.length
      }

      let requeued = 0
      let cleared = 0
      if (room > 0) {
        const retries = await tx.$queryRaw<RetryRecipientRow[]>(Prisma.sql`
          SELECT r.id, r."userId", r."eventKey", r."sellerId"
          FROM announcement_recipients r
          WHERE r."retryRequestedAt" IS NOT NULL
          ORDER BY r."retryRequestedAt", r.id
          LIMIT ${room}
          FOR UPDATE OF r SKIP LOCKED
        `)
        for (const row of retries) {
          // The guard no longer holding (retried elsewhere, now uncertain, seller deleted)
          // only clears the request.
          const requeuedRow = row.sellerId !== null && (await requeueFailedAnnouncementDelivery(tx, row))
          await tx.announcementRecipient.update({
            where: { id: row.id },
            data: { retryRequestedAt: null },
          })
          if (requeuedRow) requeued += 1
          else cleared += 1
        }
      }
      return { written: fresh.length, requeued, cleared }
    },
    { timeout: SWEEP_TX_TIMEOUT_MS, maxWait: 2_000 },
  )
}
