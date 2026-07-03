import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCouponService } from '../../api/services/coupon.service'

const {
  findByCodeMock,
  countUsageByUserMock,
} = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
  countUsageByUserMock: vi.fn(),
}))

vi.mock('../../api/repositories/coupon.repository', () => ({
  createCouponRepository: () => ({
    findByCode: findByCodeMock,
    countUsageByUser: countUsageByUserMock,
    incrementUsage: vi.fn(),
    recordUsage: vi.fn(),
  }),
}))

describe('cart coupon integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countUsageByUserMock.mockResolvedValue(0)
  })

  it('keeps non-matching seller subtotals untouched for seller-scoped percentage coupons', async () => {
    findByCodeMock.mockResolvedValue({
      id: 'coupon-1',
      code: 'S1PERCENT',
      sellerId: 'seller-1',
      isActive: true,
      startsAt: null,
      expiresAt: null,
      minCartTotal: null,
      maxUsageTotal: null,
      maxUsagePerUser: 1,
      usageCount: 0,
      discountType: 'percentage',
      discountValue: 10,
    })

    const service = createCouponService({ prisma: { $transaction: vi.fn() } as never })
    const result = await service.validateCoupon({
      code: 'S1PERCENT',
      sellerSubtotals: [
        { sellerId: 'seller-1', subtotal: 500 },
        { sellerId: 'seller-2', subtotal: 300 },
      ],
    })

    expect(result.eligibleCartTotal).toBe(500)
    expect(result.discountAmount).toBe(50)
    expect(result.finalCartTotal).toBe(750)
  })

  it('uses the whole cart total for platform-wide coupons', async () => {
    findByCodeMock.mockResolvedValue({
      id: 'coupon-2',
      code: 'GLOBAL50',
      sellerId: null,
      isActive: true,
      startsAt: null,
      expiresAt: null,
      minCartTotal: null,
      maxUsageTotal: null,
      maxUsagePerUser: 1,
      usageCount: 0,
      discountType: 'fixed_amount',
      discountValue: 50,
    })

    const service = createCouponService({ prisma: { $transaction: vi.fn() } as never })
    const result = await service.validateCoupon({
      code: 'GLOBAL50',
      sellerSubtotals: [
        { sellerId: 'seller-1', subtotal: 200 },
        { sellerId: 'seller-2', subtotal: 150 },
      ],
    })

    expect(result.sellerId).toBeNull()
    expect(result.eligibleCartTotal).toBe(350)
    expect(result.discountAmount).toBe(50)
    expect(result.finalCartTotal).toBe(300)
  })
})
