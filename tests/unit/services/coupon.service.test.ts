import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCouponService } from '../../../api/services/coupon.service'
import { ConflictError, NotFoundError, ValidationError } from '../../../api/lib/errors'

const {
  findByCodeMock,
  findByIdMock,
  countUsageByUserMock,
  recordUsageMock,
  incrementUsageMock,
  createMock,
  updateMock,
  listBySellerMock,
  createCouponRepositoryMock,
} = vi.hoisted(() => ({
  findByCodeMock: vi.fn(),
  findByIdMock: vi.fn(),
  countUsageByUserMock: vi.fn(),
  recordUsageMock: vi.fn(),
  incrementUsageMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  listBySellerMock: vi.fn(),
  createCouponRepositoryMock: vi.fn(),
}))

vi.mock('../../../api/repositories/coupon.repository', () => ({
  createCouponRepository: (...args: unknown[]) => {
    createCouponRepositoryMock(...args)
    return {
      findByCode: findByCodeMock,
      findById: findByIdMock,
      countUsageByUser: countUsageByUserMock,
      recordUsage: recordUsageMock,
      incrementUsage: incrementUsageMock,
      create: createMock,
      update: updateMock,
      listBySeller: listBySellerMock,
    }
  },
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

  it('runs inside the caller tx (no new $transaction) when tx is provided', async () => {
    recordUsageMock.mockResolvedValue({ id: 'usage-1' })
    incrementUsageMock.mockResolvedValue({ id: 'coupon-1', usageCount: 1 })
    const transactionMock = vi.fn()
    const prisma = { $transaction: transactionMock } as never
    const service = createCouponService({ prisma })
    const tx = {} as never

    await service.applyCoupon({
      couponId: 'coupon-1',
      userId: 'user-1',
      orderId: 'order-1',
      tx,
    })

    expect(transactionMock).not.toHaveBeenCalled()
    // The repo is re-instantiated bound to `tx` (closure-scoped), so the
    // individual recordUsage/incrementUsage calls don't need a per-call tx arg.
    expect(recordUsageMock).toHaveBeenCalledWith('coupon-1', 'user-1', 'order-1')
    expect(incrementUsageMock).toHaveBeenCalledWith('coupon-1')
    // Confirm the tx-scoped repository instance was actually built from `tx`.
    expect(createCouponRepositoryMock).toHaveBeenLastCalledWith(tx)
  })
})

describe('coupon.service.createSellerCoupon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes the code to uppercase/trimmed and creates the coupon', async () => {
    findByCodeMock.mockResolvedValue(null)
    createMock.mockImplementation((data: Record<string, unknown>) => ({ id: 'coupon-new', ...data }))
    const service = createCouponService({ prisma: {} as never })

    const coupon = await service.createSellerCoupon({
      sellerId: 'seller-1',
      code: '  summer10  ',
      discountType: 'percentage',
      discountValue: 10,
    })

    expect(findByCodeMock).toHaveBeenCalledWith('SUMMER10')
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SUMMER10', sellerId: 'seller-1', discountType: 'percentage', discountValue: 10 }),
    )
    expect((coupon as { code: string }).code).toBe('SUMMER10')
  })

  it('rejects a duplicate code', async () => {
    findByCodeMock.mockResolvedValue({ id: 'existing-coupon', code: 'DUPE10' })
    const service = createCouponService({ prisma: {} as never })

    await expect(
      service.createSellerCoupon({
        sellerId: 'seller-1',
        code: 'DUPE10',
        discountType: 'fixed_amount',
        discountValue: 50,
      }),
    ).rejects.toBeInstanceOf(ConflictError)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('rejects a percentage discount outside 1-100', async () => {
    const service = createCouponService({ prisma: {} as never })
    await expect(
      service.createSellerCoupon({
        sellerId: 'seller-1',
        code: 'BAD100',
        discountType: 'percentage',
        discountValue: 150,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a non-positive fixed discount', async () => {
    const service = createCouponService({ prisma: {} as never })
    await expect(
      service.createSellerCoupon({
        sellerId: 'seller-1',
        code: 'FREE0',
        discountType: 'fixed_amount',
        discountValue: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects an expiresAt date in the past', async () => {
    findByCodeMock.mockResolvedValue(null)
    const service = createCouponService({ prisma: {} as never })
    await expect(
      service.createSellerCoupon({
        sellerId: 'seller-1',
        code: 'OLD10',
        discountType: 'percentage',
        discountValue: 10,
        expiresAt: new Date('2020-01-01'),
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a maxUsageTotal below 1', async () => {
    findByCodeMock.mockResolvedValue(null)
    const service = createCouponService({ prisma: {} as never })
    await expect(
      service.createSellerCoupon({
        sellerId: 'seller-1',
        code: 'LIMIT0',
        discountType: 'percentage',
        discountValue: 10,
        maxUsageTotal: 0,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('coupon.service.updateSellerCoupon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates isActive/expiresAt/maxUsageTotal for the owning seller', async () => {
    findByIdMock.mockResolvedValue({ id: 'coupon-1', sellerId: 'seller-1' })
    updateMock.mockResolvedValue({ id: 'coupon-1', isActive: false })
    const service = createCouponService({ prisma: {} as never })

    await service.updateSellerCoupon({ sellerId: 'seller-1', couponId: 'coupon-1', isActive: false })

    expect(updateMock).toHaveBeenCalledWith('coupon-1', { isActive: false })
  })

  it('throws NotFoundError when the coupon belongs to a different seller (no existence leak)', async () => {
    findByIdMock.mockResolvedValue({ id: 'coupon-1', sellerId: 'seller-OTHER' })
    const service = createCouponService({ prisma: {} as never })

    await expect(
      service.updateSellerCoupon({ sellerId: 'seller-1', couponId: 'coupon-1', isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('throws NotFoundError when the coupon does not exist', async () => {
    findByIdMock.mockResolvedValue(null)
    const service = createCouponService({ prisma: {} as never })

    await expect(
      service.updateSellerCoupon({ sellerId: 'seller-1', couponId: 'missing', isActive: false }),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
