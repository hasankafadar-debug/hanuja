import { beforeEach, describe, expect, it, vi } from 'vitest'
const queue = vi.hoisted(() => ({ getJob: vi.fn(), add: vi.fn() }))
vi.mock('../../../api/lib/queue', () => ({
  notificationDispatchQueue: queue,
  notificationBulkQueue: queue,
}))
import {
  recordNotification,
  recordNotifications,
  relayNotifications,
  outboxJobId,
} from '../../../api/services/notification-outbox.service'
import { notificationLane } from '../../../api/lib/notification-policy'

describe('notification outbox relay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queue.getJob.mockReset().mockResolvedValue(null)
    queue.add.mockReset().mockResolvedValue({ id: 'job' })
  })
  const row = {
    id: 'o1',
    userId: 'u1',
    type: 'invoice_uploaded',
    eventKey: 'invoice:i1',
    lane: 'transactional',
    generation: 0,
    status: 'pending',
    payload: {
      userId: 'u1',
      type: 'invoice_uploaded',
      eventKey: 'invoice:i1',
      title: 'Fatura',
      body: 'Hazır',
    },
  }
  function database() {
    return {
      notificationOutbox: {
        findMany: vi
          .fn()
          .mockImplementation(async ({ where }) =>
            where.lane === 'transactional' ? [row] : [],
          ),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      notificationDelivery: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
  }

  it('terminally skips queued advertising while relaying transactional mail', async () => {
    const db: any = database()
    db.$transaction = (fn: (tx: unknown) => unknown) => fn(db)
    db.marketingChannelSettings = { findUnique: vi.fn().mockResolvedValue({ emailEnabled: false, smsEnabled: false, version: 1 }) }
    db.campaignEmailDispatch = { updateMany: vi.fn() }
    db.notificationOutbox.findMany.mockImplementation(async ({ where }: any) => where.lane === 'transactional' ? [row] : [{ ...row, id: 'ad', type: 'product_price_drop', lane: 'bulk', status: 'queued' }])
    await relayNotifications(db)
    expect(queue.add).toHaveBeenCalledTimes(1)
    expect(db.notificationOutbox.updateMany).toHaveBeenCalledWith({ where: { id: 'ad', status: { in: ['pending', 'queued'] } }, data: { status: 'completed', lastError: 'MARKETING_CHANNEL_DISABLED' } })
    expect(db.campaignEmailDispatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { eventKey: row.eventKey, status: 'reserved' } }))
  })

  it('uses the supplied transaction client and does not contact Redis while recording', async () => {
    const tx = {
      notificationOutbox: { upsert: vi.fn().mockResolvedValue(row) },
    }
    await recordNotification(tx as never, row.payload as never)
    expect(tx.notificationOutbox.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {},
        create: expect.objectContaining({ eventKey: 'invoice:i1' }),
      }),
    )
    expect(queue.add).not.toHaveBeenCalled()
  })
  it('retains the event when Redis fails and adds bounded retries when it recovers', async () => {
    const db = database()
    queue.add.mockRejectedValueOnce(new Error('Redis unavailable'))
    await expect(relayNotifications(db as never)).rejects.toThrow(
      'NOTIFICATION_QUEUE_UNAVAILABLE',
    )
    expect(db.notificationOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastError: 'QUEUE_UNAVAILABLE' } }),
    )
    await relayNotifications(db as never)
    expect(queue.add).toHaveBeenLastCalledWith(
      'notify',
      expect.objectContaining({ outboxId: 'o1' }),
      expect.objectContaining({ jobId: outboxJobId('o1', 0), attempts: 5 }),
    )
  })
  it('does not enqueue a duplicate when the queue write succeeded before DB acknowledgement crashed', async () => {
    queue.getJob.mockResolvedValue({ getState: async () => 'waiting' })
    await relayNotifications(database() as never)
    expect(queue.add).not.toHaveBeenCalled()
  })
  it('does not restart exhausted jobs automatically', async () => {
    const db = database()
    queue.getJob.mockResolvedValue({ getState: async () => 'failed' })
    await relayNotifications(db as never)
    expect(queue.add).not.toHaveBeenCalled()
    expect(db.notificationOutbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'failed', lastError: 'QUEUE_ATTEMPTS_EXHAUSTED' },
      }),
    )
  })
  it('uses a different job ID for an explicitly approved retry generation', () => {
    expect(outboxJobId('o1', 0)).not.toBe(outboxJobId('o1', 1))
  })
})

describe('announcement outbox rows', () => {
  it('puts seller announcements on the bulk lane without making them marketing mail', () => {
    expect(notificationLane('seller_announcement')).toBe('bulk')
    expect(notificationLane('product_discount_favorited')).toBe('bulk')
    expect(notificationLane('seller_product_question')).toBe('transactional')
    expect(notificationLane('order_placed')).toBe('transactional')
  })

  it('writes a batch with skipDuplicates, keyed by each event key', async () => {
    const tx = { notificationOutbox: { createMany: vi.fn().mockResolvedValue({ count: 2 }) } }
    const payloads = ['s1', 's2'].map((sellerId) => ({
      eventKey: `announcement:a1:seller:${sellerId}`,
      userId: `u-${sellerId}`,
      type: 'seller_announcement' as const,
      title: 'Yeni duyuru',
      body: 'Kargo kuralı değişti',
      data: { announcementId: 'a1', sellerName: sellerId, panelUrl: 'https://satici.test/duyurular/a1' },
    }))
    await expect(recordNotifications(tx as never, payloads)).resolves.toEqual({ count: 2 })
    expect(tx.notificationOutbox.createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({ eventKey: 'announcement:a1:seller:s1', userId: 'u-s1', lane: 'bulk' }),
        expect.objectContaining({ eventKey: 'announcement:a1:seller:s2', userId: 'u-s2', lane: 'bulk' }),
      ],
    })
  })

  it('refuses a batch row without an event key and skips an empty batch', async () => {
    const tx = { notificationOutbox: { createMany: vi.fn() } }
    await expect(
      recordNotifications(tx as never, [
        { userId: 'u1', type: 'seller_announcement', title: 't', body: 'b' },
      ]),
    ).rejects.toThrow('NOTIFICATION_EVENT_KEY_REQUIRED')
    await expect(recordNotifications(tx as never, [])).resolves.toEqual({ count: 0 })
    expect(tx.notificationOutbox.createMany).not.toHaveBeenCalled()
  })
})
