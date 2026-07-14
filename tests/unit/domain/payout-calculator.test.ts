/**
 * Unit tests — payout-calculator.ts
 * Net payout formula, hold timing, commission resolution.
 * 07-marketplace-finance-rules.md, CLAUDE.md §2.2–2.3, §15.1
 */
import { describe, it, expect } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import {
  calculateNetPayout,
  calculateHoldUntil,
  isHoldExpired,
  resolveCommissionRate,
  calculateCommission,
  allocateCouponDiscount,
  sumPayoutSnapshot,
  type PayoutComponents,
} from '../../../api/domain/payout-calculator'

// Helper: build a PayoutComponents with all deductions zeroed
function makeComponents(overrides: Partial<PayoutComponents> = {}): PayoutComponents {
  return {
    grossAmount: new Decimal(0),
    commissionAmount: new Decimal(0),
    couponShareAmount: new Decimal(0),
    cargoChargeAmount: new Decimal(0),
    adFeeAmount: new Decimal(0),
    penaltyAmount: new Decimal(0),
    refundAmount: new Decimal(0),
    adjustmentAmount: new Decimal(0),
    ...overrides,
  }
}

// ─── calculateNetPayout ───────────────────────────────────────────────────────

describe('calculateNetPayout', () => {
  it('returns gross when all deductions are 0', () => {
    const components = makeComponents({ grossAmount: new Decimal(1000) })
    expect(calculateNetPayout(components).toNumber()).toBe(1000)
  })

  it('subtracts commission correctly', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      commissionAmount: new Decimal(150),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(850)
  })

  it('subtracts all deduction types', () => {
    // Full formula: 2499 - 375 (commission 15%) - 0 (coupon) - 49 (cargo) - 0 (ad) - 0 (penalty) - 0 (refund) + 0 = 2075
    const components = makeComponents({
      grossAmount: new Decimal(2499),
      commissionAmount: new Decimal(375),
      cargoChargeAmount: new Decimal(49),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(2075)
  })

  it('applies coupon share deduction', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      commissionAmount: new Decimal(150),
      couponShareAmount: new Decimal(50),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(800)
  })

  it('applies penalty deduction', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      penaltyAmount: new Decimal(200),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(800)
  })

  it('applies refund deduction', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      refundAmount: new Decimal(1000),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(0)
  })

  it('produces negative net when deductions exceed gross (seller debt)', () => {
    // Seller rejected order: gross 0 (no payment earned), penalty 200
    const components = makeComponents({
      grossAmount: new Decimal(0),
      penaltyAmount: new Decimal(200),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(-200)
  })

  it('applies positive admin adjustment (credit)', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      commissionAmount: new Decimal(150),
      adjustmentAmount: new Decimal(50), // admin credit
    })
    expect(calculateNetPayout(components).toNumber()).toBe(900)
  })

  it('applies negative admin adjustment (debit)', () => {
    const components = makeComponents({
      grossAmount: new Decimal(1000),
      adjustmentAmount: new Decimal(-100),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(900)
  })

  it('rounds to 2 decimal places', () => {
    const components = makeComponents({
      grossAmount: new Decimal('1000.005'),
      commissionAmount: new Decimal('150.003'),
    })
    const net = calculateNetPayout(components)
    const str = net.toString()
    const decimals = str.includes('.') ? str.split('.')[1]!.length : 0
    expect(decimals).toBeLessThanOrEqual(2)
  })

  it('real-world example: Bambu Raf 15% commission + cargo', () => {
    // ORD-2026-039: gross 1299, commission ~195 (15%), cargo 0, net 1104
    const components = makeComponents({
      grossAmount: new Decimal(1299),
      commissionAmount: new Decimal(195),
    })
    expect(calculateNetPayout(components).toNumber()).toBe(1104)
  })
})

// ─── calculateHoldUntil ───────────────────────────────────────────────────────

describe('calculateHoldUntil', () => {
  it('is exactly 30 days after delivery_confirmed', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const holdUntil = calculateHoldUntil(deliveryConfirmedAt)
    expect(holdUntil.getTime()).toBe(new Date('2026-05-01T00:00:00Z').getTime())
  })

  it('preserves time-of-day component', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T14:30:00Z')
    const holdUntil = calculateHoldUntil(deliveryConfirmedAt)
    expect(holdUntil.getTime()).toBe(new Date('2026-05-01T14:30:00Z').getTime())
  })

  it('does NOT start from delivered — must be delivery_confirmed', () => {
    // This test documents the invariant; the actual enforcement is in the
    // state machine and service layer, not in the calculator itself.
    const deliveredAt = new Date('2026-04-01T00:00:00Z')
    const confirmedAt = new Date('2026-04-03T00:00:00Z') // 2 days later (silent confirm)
    const holdFromDelivered = calculateHoldUntil(deliveredAt)
    const holdFromConfirmed = calculateHoldUntil(confirmedAt)
    // countdown from confirmed is later than from delivered
    expect(holdFromConfirmed.getTime()).toBeGreaterThan(holdFromDelivered.getTime())
  })
})

// ─── isHoldExpired ────────────────────────────────────────────────────────────

describe('isHoldExpired', () => {
  it('returns false when hold is still active', () => {
    const holdUntil = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days from now
    expect(isHoldExpired(holdUntil)).toBe(false)
  })

  it('returns true when hold date is in the past', () => {
    const holdUntil = new Date(Date.now() - 1000) // 1 second ago
    expect(isHoldExpired(holdUntil)).toBe(true)
  })

  it('returns true at exactly the hold date', () => {
    const holdUntil = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-01T00:00:00Z')
    expect(isHoldExpired(holdUntil, now)).toBe(true)
  })
})

// ─── resolveCommissionRate ────────────────────────────────────────────────────

describe('resolveCommissionRate — CLAUDE.md §15.1 priority order', () => {
  const systemDefault = new Decimal('0.15')
  const sellerRate = new Decimal('0.12')
  const categoryRate = new Decimal('0.18')
  const productRate = new Decimal('0.10')

  it('uses product-specific override when present (priority 1)', () => {
    const rate = resolveCommissionRate(productRate, categoryRate, sellerRate, systemDefault)
    expect(rate.toNumber()).toBe(0.1)
  })

  it('falls back to category rate when no product override (priority 2)', () => {
    const rate = resolveCommissionRate(null, categoryRate, sellerRate, systemDefault)
    expect(rate.toNumber()).toBe(0.18)
  })

  it('falls back to seller rate when no product or category override (priority 3)', () => {
    const rate = resolveCommissionRate(null, null, sellerRate, systemDefault)
    expect(rate.toNumber()).toBe(0.12)
  })

  it('falls back to system default when all overrides are null (priority 4)', () => {
    const rate = resolveCommissionRate(null, null, null, systemDefault)
    expect(rate.toNumber()).toBe(0.15)
  })
})

// ─── calculateCommission — KDV DAHİL (07-marketplace-finance-rules.md) ────────
// commissionAmount = roundMoney(base × rate × (1 + vatRate))

describe('calculateCommission — KDV dahil', () => {
  const VAT_20 = new Decimal('0.20')

  it('calculates 15% commission + %20 KDV on ₺1000 → 180', () => {
    // 1000 * 0.15 * 1.20 = 180
    expect(calculateCommission(new Decimal(1000), new Decimal('0.15'), VAT_20).toNumber()).toBe(180)
  })

  it('calculates 15% commission + %20 KDV on ₺1299 (Bambu Raf example)', () => {
    // 1299 * 0.15 * 1.20 = 233.82
    expect(calculateCommission(new Decimal(1299), new Decimal('0.15'), VAT_20).toNumber()).toBe(233.82)
  })

  it('rounds to 2 decimal places', () => {
    // 333 * 0.15 * 1.20 = 59.94
    expect(calculateCommission(new Decimal(333), new Decimal('0.15'), VAT_20).toNumber()).toBe(59.94)
  })

  it('returns 0 commission for 0 base', () => {
    expect(calculateCommission(new Decimal(0), new Decimal('0.15'), VAT_20).toNumber()).toBe(0)
  })

  it('with vatRate 0, behaves like the old KDV-exclusive formula (historical parity)', () => {
    expect(calculateCommission(new Decimal(1000), new Decimal('0.15'), new Decimal(0)).toNumber()).toBe(150)
  })

  it('reference example: 47.421 base, %15 rate, %20 KDV → 8.535,78', () => {
    // 52.690 ürün, 5.269 kupon indirimi → müşteri öder 47.421 (komisyon tabanı)
    const base = new Decimal(47421)
    const commission = calculateCommission(base, new Decimal('0.15'), VAT_20)
    expect(commission.toNumber()).toBe(8535.78)
  })
})

// ─── allocateCouponDiscount — largest-remainder dağıtım ───────────────────────

describe('allocateCouponDiscount', () => {
  it('allocates the full discount to a single line', () => {
    const shares = allocateCouponDiscount([{ totalPrice: new Decimal(1000) }], new Decimal(100))
    expect(shares.map((s) => s.toNumber())).toEqual([100])
  })

  it('splits proportionally across multiple lines with exact penny total', () => {
    const lines = [
      { totalPrice: new Decimal(300) },
      { totalPrice: new Decimal(700) },
    ]
    const shares = allocateCouponDiscount(lines, new Decimal(100))
    expect(shares[0]!.toNumber()).toBe(30)
    expect(shares[1]!.toNumber()).toBe(70)
    const total = shares.reduce((sum, s) => sum.plus(s), new Decimal(0))
    expect(total.toNumber()).toBe(100)
  })

  it('largest-remainder distributes rounding penny to no penny drift (3-way split)', () => {
    // 100 / 3 lines of equal value → 33.33 each would sum to 99.99, not 100.
    // Largest-remainder gives one line an extra 0.01 so the sum is exact.
    const lines = [
      { totalPrice: new Decimal(100) },
      { totalPrice: new Decimal(100) },
      { totalPrice: new Decimal(100) },
    ]
    const shares = allocateCouponDiscount(lines, new Decimal(100))
    const total = shares.reduce((sum, s) => sum.plus(s), new Decimal(0))
    expect(total.toNumber()).toBe(100)
    // Two lines get 33.33, one gets 33.34 (or equivalent exact-sum distribution)
    const sorted = shares.map((s) => s.toNumber()).sort((a, b) => a - b)
    expect(sorted[0]).toBeCloseTo(33.33, 2)
    expect(sorted[2]).toBeCloseTo(33.34, 2)
  })

  it('returns all zeros for empty discount', () => {
    const lines = [{ totalPrice: new Decimal(500) }, { totalPrice: new Decimal(500) }]
    const shares = allocateCouponDiscount(lines, new Decimal(0))
    expect(shares.map((s) => s.toNumber())).toEqual([0, 0])
  })

  it('returns all zeros for negative discount (defensive)', () => {
    const lines = [{ totalPrice: new Decimal(500) }]
    const shares = allocateCouponDiscount(lines, new Decimal(-50))
    expect(shares.map((s) => s.toNumber())).toEqual([0])
  })

  it('returns empty array for empty line list', () => {
    expect(allocateCouponDiscount([], new Decimal(100))).toEqual([])
  })

  it('clamps discount to the sum of line totals when discount exceeds it', () => {
    const lines = [{ totalPrice: new Decimal(100) }]
    const shares = allocateCouponDiscount(lines, new Decimal(500))
    expect(shares[0]!.toNumber()).toBe(100)
  })

  it('reference example: 52.690 product, 5.269 coupon discount allocated to one line', () => {
    const shares = allocateCouponDiscount([{ totalPrice: new Decimal(52690) }], new Decimal(5269))
    expect(shares[0]!.toNumber()).toBe(5269)
  })
})

// ─── Reference example (end-to-end) — 52.690 → 8.535,78 → 38.885,22 ──────────
// CLAUDE.md işbağlamı kararı: ürün 52.690,00; kupon indirimi 5.269,00;
// müşteri öder 47.421,00; komisyon %15 → 47.421 × 0,15 × 1,20 = 8.535,78;
// netPayout = 47.421 − 8.535,78 = 38.885,22.

describe('reference example — satıcı kuponu + KDV dahil komisyon', () => {
  it('matches the documented reference calculation exactly', () => {
    const totalPrice = new Decimal(52690)
    const couponDiscountAmount = allocateCouponDiscount(
      [{ totalPrice }],
      new Decimal(5269),
    )[0]!
    expect(couponDiscountAmount.toNumber()).toBe(5269)

    const commissionBase = totalPrice.sub(couponDiscountAmount)
    expect(commissionBase.toNumber()).toBe(47421)

    const commissionAmount = calculateCommission(
      commissionBase,
      new Decimal('0.15'),
      new Decimal('0.20'),
    )
    expect(commissionAmount.toNumber()).toBe(8535.78)

    const netPayoutAmount = commissionBase.sub(commissionAmount)
    expect(netPayoutAmount.toNumber()).toBeCloseTo(38885.22, 2)

    // sumPayoutSnapshot aggregation matches the same line-level math
    const snapshot = sumPayoutSnapshot([
      {
        totalPrice,
        commissionAmount,
        netPayoutAmount,
        couponDiscountAmount,
      },
    ])
    expect(snapshot.grossAmount.toNumber()).toBe(52690)
    expect(snapshot.couponShareAmount.toNumber()).toBe(5269)
    expect(snapshot.commissionAmount.toNumber()).toBe(8535.78)
    expect(snapshot.netAmount.toNumber()).toBeCloseTo(38885.22, 2)
  })
})
