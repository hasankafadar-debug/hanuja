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

// ─── calculateCommission ──────────────────────────────────────────────────────

describe('calculateCommission', () => {
  it('calculates 15% commission on ₺1000', () => {
    expect(calculateCommission(new Decimal(1000), new Decimal('0.15')).toNumber()).toBe(150)
  })

  it('calculates 15% commission on ₺1299 (Bambu Raf example)', () => {
    expect(calculateCommission(new Decimal(1299), new Decimal('0.15')).toNumber()).toBe(194.85)
  })

  it('rounds to 2 decimal places', () => {
    // 333 * 0.15 = 49.95 — exact 2dp
    expect(calculateCommission(new Decimal(333), new Decimal('0.15')).toNumber()).toBe(49.95)
  })

  it('returns 0 commission for 0 gross', () => {
    expect(calculateCommission(new Decimal(0), new Decimal('0.15')).toNumber()).toBe(0)
  })
})
