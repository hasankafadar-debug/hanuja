import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCouponService } from '../../../api/services/coupon.service'
import { ValidationError } from '../../../api/lib/errors'

const {
  findByCodeMock,
  countUsageByUserMock,
  recordUsageMock,
  incrementUsageMock,
} = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
  countUsageByUserMock: vi.fn(),
  recordUsageMock: vi.fn(),
  incrementUsageMock: vi.fn(),
}))

vi.mock('../../../api/repositories/coupon.repository', () => ({
  createCouponRepository: () => ({
    findByCode: findByCodeMock,
    countUsageByUser: countUsageByUserMock,
    recordUsage: recordUsageMock,
    incrementUsage: incrementUsageMock,
  }),
}))

function makeCoupon(overrides: Record<string, unknown> = {}) {
  return {
    id: 'coupon-1',
    code: 'SELLER10',
    sellerId: 'seller-1',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    minCartTotal: null,
    maxUsageTotal: null,
    maxUsagePerUser: 1,
    usageCount: 0,
    discountType: 'fixed_amount',
    discountValue: 100,
    ...overrides,
  }
}

describe('coupon.service.validateCoupon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countUsageByUserMock.mockResolvedValue(0)
  })

  it('applies seller-scoped coupon only to the matching seller subtotal', async () => {
    findByCodeMock.mockResolvedValue(makeCoupon({ discountValue: 80 }))
    const prisma = { $transaction: vi.fn() } as never
    const service = createCouponService({ prisma })

    const result = await service.validateCoupon({
      code: 'SELLER10',
      userId: 'user-1',
      sellerSubtotals: [
        { sellerId: 'seller-1', subtotal: 120 },
        { sellerId: 'seller-2', subtotal: 300 },
      ],
    })

    expect(result.sellerId).toBe('seller-1')
    expect(result.eligibleCartTotal).toBe(120)
    expect(result.discountAmount).toBe(80)
    expect(result.finalCartTotal).toBe(340)
  })

  it('uses the matching seller subtotal for minimum cart validation', async () => {
    findByCodeMock.mockResolvedValue(makeCoupon({ minCartTotal: 200 }))
    const prisma = { $transaction: vi.fn() } as never
    const service = createCouponService({ prisma })

    await expect(
      service.validateCoupon({
        code: 'SELLER10',
        sellerSubtotals: [
          { sellerId: 'seller-1', subtotal: 150 },
          { sellerId: 'seller-2', subtotal: 500 },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('blocks reuse when the customer reached the per-user limit', async () => {
    findByCodeMock.mockResolvedValue(makeCoupon({ maxUsagePerUser: 2 }))
    countUsageByUserMock.mockResolvedValue(2)
    const prisma = { $transaction: vi.fn() } as never
    const service = createCouponService({ prisma })

    await expect(
      service.validateCoupon({
        code: 'SELLER10',
        userId: 'user-1',
        cartTotal: 250,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('coupon.service.applyCoupon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records usage and increments the aggregate count in one transaction', async () => {
    recordUsageMock.mockReturnValue({ op: 'record' })
    incrementUsageMock.mockReturnValue({ op: 'increment' })
    const transactionMock = vi.fn(async (operations: unknown[]) => operations)
    const prisma = { $transaction: transactionMock } as never
    const service = createCouponService({ prisma })

    await service.applyCoupon({
      couponId: 'coupon-1',
      userId: 'user-1',
      orderId: 'order-1',
    })

    expect(recordUsageMock).toHaveBeenCalledWith('coupon-1', 'user-1', 'order-1')
    expect(incrementUsageMock).toHaveBeenCalledWith('coupon-1')
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })
})
