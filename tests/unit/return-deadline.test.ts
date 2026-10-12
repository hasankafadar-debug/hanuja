import { describe, expect, it, vi } from 'vitest'
import { recordReturnCarrierReceipt, refundDeadline, sweepReturnDeadlines } from '../../api/services/return-deadline.service'

describe('return refund deadlines', () => {
  it('does not extend a recorded deadline when receipt is confirmed later', async () => {
    const deadline = new Date('2026-09-15T10:00:00Z')
    const tx = {
      returnRequest: { findUniqueOrThrow: vi.fn().mockResolvedValue({ refundDeadlineAt: deadline }), update: vi.fn().mockResolvedValue({}) },
      adminAuditLog: { create: vi.fn() },
    }
    await recordReturnCarrierReceipt({ $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) } as never, 'return-1', new Date('2026-09-05T10:00:00Z'), 'admin')
    expect(tx.returnRequest.update).toHaveBeenCalledWith({ where: { id: 'return-1' }, data: { returnCarrierDeliveredAt: new Date('2026-09-05T10:00:00Z'), refundDeadlineAt: deadline } })
  })

  it('sets fourteen days from verified receipt and rejects future receipt dates', async () => {
    expect(refundDeadline(new Date('2026-09-01T10:00:00Z'))).toEqual(new Date('2026-09-15T10:00:00Z'))
    await expect(recordReturnCarrierReceipt({} as never, 'return-1', new Date(Date.now() + 86400000), 'admin')).rejects.toMatchObject({ statusCode: 422 })
  })

  it('uses durable recipient-specific notification keys for approaching and overdue states', async () => {
    const tx = { notificationOutbox: { upsert: vi.fn().mockResolvedValue({}) } }
    const prisma = {
      returnRequest: { findMany: vi.fn().mockResolvedValue([{ id: 'return-1', orderId: 'order-1', refundDeadlineAt: new Date('2026-09-15T10:00:00Z'), escalatedDispute: null }]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: 'admin' }]) },
      $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
    }
    await sweepReturnDeadlines(prisma as never, new Date('2026-09-14'))
    await sweepReturnDeadlines(prisma as never, new Date('2026-09-16'))
    expect(tx.notificationOutbox.upsert.mock.calls[0]?.[0].where.userId_type_eventKey.eventKey).toContain(':approaching:admin')
    expect(tx.notificationOutbox.upsert.mock.calls[1]?.[0].where.userId_type_eventKey.eventKey).toContain(':overdue:admin')
  })
})
