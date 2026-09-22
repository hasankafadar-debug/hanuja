import { beforeEach, describe, expect, it, vi } from 'vitest'
const queue = vi.hoisted(() => ({ getJob: vi.fn(), add: vi.fn() }))
vi.mock('../../../api/lib/queue', () => ({
  notificationDispatchQueue: queue,
  notificationBulkQueue: queue,
}))
import {
  recordNotification,
  relayNotifications,
  outboxJobId,
} from '../../../api/services/notification-outbox.service'

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
