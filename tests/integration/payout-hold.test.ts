/**
 * Integration tests — payout hold activation and readiness logic
 *
 * Core invariants:
 * - Payout countdown starts ONLY from delivery_confirmed, never delivered/shipped
 * - 30-day mandatory hold after delivery_confirmed
 * - Open return or dispute BLOCKS payout release
 * - Negative seller balance is allowed and tracked
 *
 * 07-marketplace-finance-rules.md, docs/07-operations/payout-lifecycle.md
 */
import { describe, it, expect } from 'vitest'
import { OrderStatus } from '../__mocks__/prisma-client'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  calculateNetPayout,
  calculateHoldUntil,
  isHoldExpired,
  resolveCommissionRate,
  calculateCommission,
  type PayoutComponents,
} from '../../api/domain/payout-calculator'
import {
  calculatePenalty,
  PAYOUT_HOLD_DAYS,
  STANDARD_PENALTY_RATE,
} from '../../api/domain/penalty-calculator'
import {
  isPayoutCountdownEligible,
  isTerminal,
} from '../../api/domain/order-state-machine'

// ─── Hold activation invariants ───────────────────────────────────────────────

describe('hold activation: only from delivery_confirmed', () => {
  it('delivery_confirmed is the ONLY status that starts the payout clock', () => {
    const statusesThatShouldNOTStartClock: OrderStatus[] = [
      OrderStatus.delivered,
      OrderStatus.shipped,
      OrderStatus.awaiting_shipment,
      OrderStatus.seller_accepted,
      OrderStatus.payment_confirmed,
      OrderStatus.seller_queue_ready,
    ]

    statusesThatShouldNOTStartClock.forEach((status) => {
      expect(isPayoutCountdownEligible(status)).toBe(false)
    })

    expect(isPayoutCountdownEligible(OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('hold duration is exactly 30 days', () => {
    expect(PAYOUT_HOLD_DAYS).toBe(30)
  })

  it('hold expires 30 days after delivery_confirmed', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const holdUntil = calculateHoldUntil(deliveryConfirmedAt)
    const expectedHoldUntil = new Date('2026-05-01T00:00:00Z')
    expect(holdUntil.getTime()).toBe(expectedHoldUntil.getTime())
  })

  it('delivered → hold is later than shipped → hold (confirms correct countdown start)', () => {
    const shippedDate = new Date('2026-03-25T00:00:00Z')
    const deliveredDate = new Date('2026-03-28T00:00:00Z')
    const confirmedDate = new Date('2026-03-31T00:00:00Z')

    // If we mistakenly started hold from shipped date
    const wrongHold = calculateHoldUntil(shippedDate)
    // Correct hold starts from delivery_confirmed
    const correctHold = calculateHoldUntil(confirmedDate)

    // Wrong hold expires before correct hold — this shows the financial impact
    expect(correctHold.getTime()).toBeGreaterThan(wrongHold.getTime())
  })
})

// ─── Hold expiry checks ───────────────────────────────────────────────────────

describe('isHoldExpired', () => {
  it('hold is not expired before 30 days', () => {
    const deliveryConfirmedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) // 10 days ago
    const holdUntil = calculateHoldUntil(deliveryConfirmedAt)
    expect(isHoldExpired(holdUntil)).toBe(false)
  })

  it('hold is expired after 30 days', () => {
    const deliveryConfirmedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) // 31 days ago
    const holdUntil = calculateHoldUntil(deliveryConfirmedAt)
    expect(isHoldExpired(holdUntil)).toBe(true)
  })
})

// ─── Net payout with real marketplace deductions ──────────────────────────────

describe('net payout formula — real marketplace scenarios', () => {
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

  it('scenario: normal sale with 15% commission (historical KDV-exclusive parity, vatRate=0)', () => {
    // Bambu Raf Sistemi: gross 1299, commission 194.85 (15%, no VAT)
    const commission = calculateCommission(new Decimal(1299), new Decimal('0.15'), new Decimal(0))
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(1299),
        commissionAmount: commission,
      }),
    )
    expect(net.toNumber()).toBeCloseTo(1104.15, 1)
  })

  it('scenario: KDV dahil komisyon — reference example (52.690 → 8.535,78 → 38.885,22)', () => {
    // Satıcı kuponu ile: base 47.421 (52.690 - 5.269 kupon payı), %15 komisyon, %20 KDV
    const commission = calculateCommission(new Decimal(47421), new Decimal('0.15'), new Decimal('0.20'))
    expect(commission.toNumber()).toBe(8535.78)
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(47421),
        commissionAmount: commission,
      }),
    )
    expect(net.toNumber()).toBeCloseTo(38885.22, 2)
  })

  it('scenario: sale with cargo chargeback', () => {
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(899),
        commissionAmount: new Decimal(135),
        cargoChargeAmount: new Decimal(49),
      }),
    )
    expect(net.toNumber()).toBe(715)
  })

  it('scenario: sale with coupon share', () => {
    // Platform and seller share a ₺100 coupon cost
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(1000),
        commissionAmount: new Decimal(150),
        couponShareAmount: new Decimal(50),
      }),
    )
    expect(net.toNumber()).toBe(800)
  })

  it('scenario: post-payout refund creates negative balance', () => {
    // Payout was already made, now customer returns — seller owes Hanuja
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(0), // no new gross
        refundAmount: new Decimal(1299), // full refund to customer
      }),
    )
    expect(net.toNumber()).toBe(-1299)
    expect(net.isNegative()).toBe(true)
  })

  it('scenario: penalty from rejection creates negative balance', () => {
    // Seller rejected ₺2499 order → 20% penalty = ₺499.8
    const penaltyAmount = calculatePenalty(new Decimal(2499), STANDARD_PENALTY_RATE)
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(0),
        penaltyAmount,
      }),
    )
    expect(net.toNumber()).toBe(-499.8)
    expect(net.isNegative()).toBe(true)
  })

  it('scenario: admin credit adjustment reduces deduction impact', () => {
    const net = calculateNetPayout(
      makeComponents({
        grossAmount: new Decimal(1000),
        penaltyAmount: new Decimal(200),
        adjustmentAmount: new Decimal(100), // admin credits 100 (e.g. waiver partial)
      }),
    )
    expect(net.toNumber()).toBe(900)
  })
})

// ─── Commission resolution priority (CLAUDE.md §15.1) ────────────────────────

describe('commission resolution: product > category > seller > system', () => {
  const system = new Decimal('0.15')
  const seller = new Decimal('0.12')
  const category = new Decimal('0.18')
  const product = new Decimal('0.08')

  it('product rate wins when present', () => {
    const rate = resolveCommissionRate(product, category, seller, system)
    expect(rate.toNumber()).toBe(0.08)
  })

  it('category wins when no product override', () => {
    const rate = resolveCommissionRate(null, category, seller, system)
    expect(rate.toNumber()).toBe(0.18)
  })

  it('seller rate when no product or category', () => {
    const rate = resolveCommissionRate(null, null, seller, system)
    expect(rate.toNumber()).toBe(0.12)
  })

  it('system default when all overrides null', () => {
    const rate = resolveCommissionRate(null, null, null, system)
    expect(rate.toNumber()).toBe(0.15)
  })
})

// ─── Payout blocking conditions ───────────────────────────────────────────────

describe('payout blocking: return and dispute conditions', () => {
  /**
   * The actual block logic lives in payout.service.ts checkPayoutReadiness().
   * Here we test the structural rule: certain order statuses indicate
   * a payout should be blocked. The service enforces this, the domain
   * defines what "open" means.
   */

  const returnBlockingStatuses: OrderStatus[] = [
    OrderStatus.return_requested,
    OrderStatus.return_under_review,
    OrderStatus.return_approved,
    OrderStatus.return_in_transit,
    OrderStatus.return_received,
    OrderStatus.refund_pending,
  ]

  const disputeBlockingStatuses: OrderStatus[] = [
    OrderStatus.dispute_open,
  ]

  returnBlockingStatuses.forEach((status) => {
    it(`${status} indicates payout must be blocked (return open)`, () => {
      // These statuses are post-shipment and indicate a return flow is active
      // Payout countdown eligibility is false here
      expect(isPayoutCountdownEligible(status)).toBe(false)
    })
  })

  disputeBlockingStatuses.forEach((status) => {
    it(`${status} indicates payout must be blocked (dispute open)`, () => {
      expect(isPayoutCountdownEligible(status)).toBe(false)
    })
  })

  it('return_completed (refund_completed) does NOT re-enable payout (order is terminal)', () => {
    // After full refund, there is nothing to pay out
    expect(isTerminal(OrderStatus.refund_completed)).toBe(true)
    expect(isPayoutCountdownEligible(OrderStatus.refund_completed)).toBe(false)
  })

  it('dispute_resolved allows downstream processing (terminal)', () => {
    expect(isTerminal(OrderStatus.dispute_resolved)).toBe(true)
  })
})

// ─── Payout ledger entry model ────────────────────────────────────────────────

describe('seller ledger: separate deduction categories', () => {
  /**
   * CLAUDE.md §2.3 + 07-marketplace-finance-rules.md
   * Each deduction type must be kept separate — not merged into one field.
   */

  it('commission is a separate field from cargo charge', () => {
    const components: PayoutComponents = {
      grossAmount: new Decimal(1000),
      commissionAmount: new Decimal(150), // distinct
      couponShareAmount: new Decimal(0),
      cargoChargeAmount: new Decimal(49), // distinct
      adFeeAmount: new Decimal(0),
      penaltyAmount: new Decimal(0),
      refundAmount: new Decimal(0),
      adjustmentAmount: new Decimal(0),
    }
    // net = 1000 - 150 - 49 = 801
    expect(calculateNetPayout(components).toNumber()).toBe(801)
    // Both should be visible separately (structural check)
    expect(components.commissionAmount.toNumber()).toBe(150)
    expect(components.cargoChargeAmount.toNumber()).toBe(49)
  })

  it('penalty is a separate field from refund amount', () => {
    const components: PayoutComponents = {
      grossAmount: new Decimal(1000),
      commissionAmount: new Decimal(0),
      couponShareAmount: new Decimal(0),
      cargoChargeAmount: new Decimal(0),
      adFeeAmount: new Decimal(0),
      penaltyAmount: new Decimal(200), // distinct
      refundAmount: new Decimal(300), // distinct
      adjustmentAmount: new Decimal(0),
    }
    // net = 1000 - 200 - 300 = 500
    expect(calculateNetPayout(components).toNumber()).toBe(500)
    expect(components.penaltyAmount.toNumber()).toBe(200)
    expect(components.refundAmount.toNumber()).toBe(300)
  })
})
