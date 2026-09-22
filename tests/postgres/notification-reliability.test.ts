import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { recordNotification } from '../../api/services/notification-outbox.service'
import { processNotificationDispatch } from '../../api/jobs/notification-dispatch.job'
import { createNotificationOperationsService } from '../../api/services/notification-operations.service'
import { reconcileEmailProviderEvents } from '../../api/services/email-provider-event.service'

const send = vi.hoisted(() => vi.fn())
vi.mock('../../api/lib/mailer', () => ({ sendEmail: send }))
vi.mock('../../api/lib/prisma', () => ({
  get prisma() {
    return prisma
  },
}))
const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error(
    'NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test',
  )
const url = new URL(testUrl)
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
)
  throw new Error('Refusing non-local notification test database')
const schema = `notification_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
})
beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve('../db/schema/schema.prisma'),
    ],
    {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    },
  )
  await prisma.$connect()
})
afterAll(async () => {
  if (!/^notification_test_[a-f0-9]{32}$/.test(schema))
    throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

describe('notification persistence against PostgreSQL', () => {
  it('does not overwrite a complaint committed after a webhook snapshot was read', async () => {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test` },
    })
    const providerMessageId = randomUUID()
    const delivery = await prisma.notificationDelivery.create({
      data: {
        userId: user.id,
        eventKey: randomUUID(),
        type: 'invoice_uploaded',
        channel: 'email',
        recipient: user.email,
        providerMessageId,
      },
    })
    await prisma.emailProviderEvent.create({
      data: {
        id: randomUUID(),
        providerMessageId,
        type: 'email.sent',
        occurredAt: new Date(),
      },
    })
    const concurrentClient = prisma.$extends({
      query: {
        emailProviderEvent: {
          async findMany({ args, query }) {
            const staleSnapshot = await query(args)
            // A second handler commits the higher-priority outcome before the
            // first handler can persist its old sent snapshot.
            await prisma.notificationDelivery.update({
              where: { id: delivery.id },
              data: { transportStatus: 'complained', status: 'sent' },
            })
            return staleSnapshot
          },
        },
      },
    })
    await reconcileEmailProviderEvents(
      concurrentClient as unknown as PrismaClient,
      delivery.id,
    )
    expect(
      (
        await prisma.notificationDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        })
      ).transportStatus,
    ).toBe('complained')
  })
  it('rolls back business write and notification intent together', async () => {
    const id = randomUUID()
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.user.create({ data: { id, email: `${id}@example.test` } })
        await recordNotification(tx, {
          userId: id,
          eventKey: id,
          type: 'invoice_uploaded',
          title: 'Test',
          body: 'Test',
        })
        throw new Error('ROLLBACK')
      }),
    ).rejects.toThrow('ROLLBACK')
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull()
    expect(
      await prisma.notificationOutbox.count({ where: { userId: id } }),
    ).toBe(0)
  })
  it('deduplicates concurrent event creation and concurrent worker delivery', async () => {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, role: 'customer' },
    })
    const payload = {
      userId: user.id,
      eventKey: randomUUID(),
      type: 'invoice_uploaded' as const,
      title: 'Fatura',
      body: 'Hazır',
      data: {
        orderNumber: '123',
        orderUrl: 'https://www.hanuja.com.tr/siparis/test',
      },
    }
    const records = await Promise.all([
      recordNotification(prisma, payload),
      recordNotification(prisma, payload),
    ])
    expect(records[0].id).toBe(records[1].id)
    send.mockResolvedValue({
      messageId: '<test@example.test>',
      providerMessageId: 'provider-test',
      transport: 'smtp',
    })
    const task = { id: 'postgres-job', data: payload } as never
    await Promise.allSettled([
      processNotificationDispatch(task),
      processNotificationDispatch(task),
    ])
    await processNotificationDispatch(task)
    expect(send).toHaveBeenCalledTimes(1)
    expect(
      await prisma.notification.count({ where: { userId: user.id } }),
    ).toBe(1)
    const delivery = await prisma.notificationDelivery.findFirstOrThrow({
      where: { userId: user.id, channel: 'email' },
    })
    expect(delivery.smtpAcceptedAt).not.toBeNull()
    expect(delivery.deliveredAt).toBeNull()
    const admin = await prisma.user.create({
      data: { email: `${randomUUID()}@example.test`, role: 'admin' },
    })
    await expect(
      createNotificationOperationsService(prisma).retry(
        admin.id,
        delivery.id,
        'Tekrar gönderim deneniyor',
        'delivery',
      ),
    ).rejects.toThrow()
  })
})
