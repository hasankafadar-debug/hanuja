import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { createOrderRepository } from '../../../api/repositories/order.repository'
import { createOrderService } from '../../../api/services/order.service'

vi.mock('../../../api/services/payment.service', () => ({ createPaymentService: () => ({}) }))
vi.mock('../../../api/services/penalty.service', () => ({ createPenaltyService: () => ({}) }))
vi.mock('../../../api/services/quantity-cancellation.service', () => ({ createQuantityCancellationService: () => ({}) }))

afterEach(() => vi.useRealTimers())

describe('admin overdue list ordering and pagination', () => {
  it('intersects search filters before selecting a page in longest-waiting order', async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ id: 'newest' }, { id: 'oldest' }, { id: 'middle' }])
      .mockResolvedValueOnce([{ id: 'newest' }, { id: 'middle' }])
    const count = vi.fn()
    const prisma = { order: { findMany, count } } as unknown as PrismaClient
    const result = await createOrderRepository(prisma).listForAdmin({
      orderedOrderIds: ['oldest', 'excluded-by-search', 'middle', 'newest'],
      query: 'lamp', sellerId: 'seller-1', skip: 1, take: 2,
    })
    expect(result.total).toBe(3)
    expect(result.rows.map((row) => row.id)).toEqual(['middle', 'newest'])
    const candidateWhere = findMany.mock.calls[0][0].where
    expect(candidateWhere.id.in).toEqual(['oldest', 'excluded-by-search', 'middle', 'newest'])
    expect(candidateWhere.lines.some.sellerId).toBe('seller-1')
    expect(candidateWhere.OR).toContainEqual({ id: { contains: 'lamp' } })
    const pageQuery = findMany.mock.calls[1][0]
    expect(pageQuery.where.AND).toEqual([candidateWhere, { id: { in: ['middle', 'newest'] } }])
    expect(pageQuery.skip).toBeUndefined()
    expect(count).not.toHaveBeenCalled()
  })

  it('keeps an empty overdue queue empty instead of falling back to all orders', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    const prisma = { order: { findMany, count: vi.fn() } } as unknown as PrismaClient
    expect(await createOrderRepository(prisma).listForAdmin({ orderedOrderIds: [] }))
      .toEqual({ rows: [], total: 0 })
    expect(findMany.mock.calls[0][0].where.id.in).toEqual([])
    expect(findMany.mock.calls[1][0].where.AND[1].id.in).toEqual([])
  })

  it('preserves ordinary list ordering, counting and pagination', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'normal' }])
    const count = vi.fn().mockResolvedValue(25)
    const prisma = { order: { findMany, count } } as unknown as PrismaClient
    const result = await createOrderRepository(prisma).listForAdmin({ skip: 20, take: 5 })
    expect(result.total).toBe(25)
    expect(findMany).toHaveBeenCalledOnce()
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 20, take: 5, orderBy: { createdAt: 'desc' } })
  })

  it('uses the shared overdue query and returns seller metadata for list and export', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-21T12:00:00Z'))
    const waitingSince = new Date('2026-09-20T12:00:00Z')
    const candidate = {
      id: 'overdue', status: 'seller_accepted', quantityLifecycleVersion: 2,
      sellerQueueReadyAt: waitingSince, paymentConfirmedAt: waitingSince, cancelledAt: null,
      lines: [{ sellerId: 'pending-seller', quantity: 1, cancelledQuantity: 0, shippedQuantity: 0 }],
      sellerFulfillments: [{ sellerId: 'pending-seller', status: 'reviewing', acceptedAt: null }],
    }
    const findMany = vi.fn()
      .mockResolvedValueOnce([candidate])
      .mockResolvedValueOnce([{ id: 'overdue' }])
      .mockResolvedValueOnce([{ id: 'overdue', paymentConfirmedAt: waitingSince }])
    const prisma = { order: { findMany, count: vi.fn() } } as unknown as PrismaClient
    const result = await createOrderService({ prisma }).listForAdmin({ sellerApprovalOverdue: true, take: 20 })
    expect(result.total).toBe(1)
    expect(result.rows[0].sellerApprovalOverdue).toEqual({
      orderId: 'overdue', waitingSince, sellerIds: ['pending-seller'],
    })
    expect(findMany.mock.calls[1][0].where.id.in).toEqual(['overdue'])
  })
})
