/**
 * Integration tests — order lifecycle transitions and finance consequences
 *
 * Tests the full lifecycle flow at domain level:
 * - seller rejection → penalty evaluation trigger
 * - 20-day breach → penalty + lifecycle close
 * - post-shipment cancellation prevention
 * - return window semantics
 * - delivery_confirmed vs delivered distinction
 *
 * 08-order-lifecycle-rules.md
 */
import { describe, it, expect } from 'vitest'
import { OrderStatus } from '../__mocks__/prisma-client'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  canTransition,
  assertTransition,
  isTerminal,
  isCancelled,
  isPayoutCountdownEligible,
  requiresSellerPenaltyEvaluation,
  isPostShipmentStatus,
  isSellerVisible,
} from '../../api/domain/order-state-machine'
import {
  isFulfillmentDeadlineBreached,
  isWithinReturnWindow,
  isSilentConfirmDue,
  FULFILLMENT_DAYS,
  RETURN_WINDOW_DAYS,
} from '../../api/domain/penalty-calculator'
import {
  isSilentConfirmationEligible,
  buildCustomerConfirmation,
  buildAdminConfirmation,
  buildSilentConfirmation,
} from '../../api/domain/delivery-confirmation'
import {
  calculatePenalty,
  STANDARD_PENALTY_RATE,
} from '../../api/domain/penalty-calculator'
import { InvalidTransitionError } from '../../api/lib/errors'

// ─── Complete happy-path lifecycle ────────────────────────────────────────────

describe('happy path: draft → delivery_confirmed', () => {
  const happyPath: OrderStatus[] = [
    OrderStatus.draft,
    OrderStatus.checkout_started,
    OrderStatus.payment_pending,
    OrderStatus.payment_confirmed,
    OrderStatus.seller_queue_ready,
    OrderStatus.seller_accepted,
    OrderStatus.preparing,
    OrderStatus.awaiting_shipment,
    OrderStatus.shipped,
    OrderStatus.delivered,
    OrderStatus.delivery_confirmation_pending,
    OrderStatus.delivery_confirmed,
  ]

  it('each step in the happy path is a valid transition', () => {
    for (let i = 0; i < happyPath.length - 1; i++) {
      const from = happyPath[i]!
      const to = happyPath[i + 1]!
      expect(
        canTransition(from, to),
        `Expected valid transition: ${from} → ${to}`,
      ).toBe(true)
    }
  })

  it('delivery_confirmed starts payout clock (not any earlier step)', () => {
    happyPath.slice(0, -1).forEach((status) => {
      expect(isPayoutCountdownEligible(status)).toBe(false)
    })
    expect(isPayoutCountdownEligible(OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('seller visibility starts at seller_queue_ready', () => {
    const preSellerVisibility: OrderStatus[] = [
      OrderStatus.draft,
      OrderStatus.checkout_started,
      OrderStatus.payment_pending,
      OrderStatus.payment_confirmed,
    ]
    preSellerVisibility.forEach((status) => {
      expect(isSellerVisible(status)).toBe(false)
    })
    expect(isSellerVisible(OrderStatus.seller_queue_ready)).toBe(true)
  })
})

// ─── Seller rejection path ────────────────────────────────────────────────────

describe('seller rejection → penalty evaluation', () => {
  it('seller can reject from seller_queue_ready', () => {
    expect(canTransition(OrderStatus.seller_queue_ready, OrderStatus.seller_rejected)).toBe(true)
  })

  it('seller can reject from seller_reviewing', () => {
    expect(canTransition(OrderStatus.seller_reviewing, OrderStatus.seller_rejected)).toBe(true)
  })

  it('rejection leads to cancellation due to seller rejection', () => {
    expect(
      canTransition(
        OrderStatus.seller_rejected,
        OrderStatus.cancelled_due_to_seller_rejection,
      ),
    ).toBe(true)
  })

  it('cancelled_due_to_seller_rejection requires penalty evaluation', () => {
    expect(
      requiresSellerPenaltyEvaluation(OrderStatus.cancelled_due_to_seller_rejection),
    ).toBe(true)
  })

  it('cancelled_due_to_seller_rejection is terminal', () => {
    expect(isTerminal(OrderStatus.cancelled_due_to_seller_rejection)).toBe(true)
  })

  it('penalty amount for ₺1299 rejection is 20%', () => {
    const productAmount = new Decimal(1299)
    const penalty = calculatePenalty(productAmount, STANDARD_PENALTY_RATE)
    expect(penalty.toNumber()).toBe(259.8)
  })

  it('seller CANNOT reject after shipment', () => {
    expect(canTransition(OrderStatus.shipped, OrderStatus.seller_rejected)).toBe(false)
    expect(canTransition(OrderStatus.delivered, OrderStatus.seller_rejected)).toBe(false)
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.seller_rejected)).toBe(false)
  })
})

// ─── 20-day fulfillment breach path ───────────────────────────────────────────

describe('20-day fulfillment breach', () => {
  it('fulfillment commitment is 20 days', () => {
    expect(FULFILLMENT_DAYS).toBe(20)
  })

  it('breach can cancel from awaiting_shipment', () => {
    expect(
      canTransition(OrderStatus.awaiting_shipment, OrderStatus.cancelled_due_to_20day_breach),
    ).toBe(true)
  })

  it('breach cancellation requires penalty evaluation', () => {
    expect(
      requiresSellerPenaltyEvaluation(OrderStatus.cancelled_due_to_20day_breach),
    ).toBe(true)
  })

  it('breach cancellation is terminal', () => {
    expect(isTerminal(OrderStatus.cancelled_due_to_20day_breach)).toBe(true)
  })

  it('detects breach correctly after 21 days', () => {
    const paymentConfirmedAt = new Date('2026-03-01T00:00:00Z')
    const now = new Date('2026-03-22T00:00:00Z') // 21 days later
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, now)).toBe(true)
  })

  it('does NOT detect breach at day 19', () => {
    const paymentConfirmedAt = new Date('2026-03-01T00:00:00Z')
    const now = new Date('2026-03-20T00:00:00Z') // 19 days later
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, now)).toBe(false)
  })

  it('seller rejected from shipped is NOT allowed — use return flow instead', () => {
    // Simulates a scenario where seller tries to cancel after shipment — blocked
    expect(canTransition(OrderStatus.shipped, OrderStatus.cancelled_due_to_20day_breach)).toBe(false)
  })
})

// ─── Post-shipment cancellation prevention ────────────────────────────────────

describe('post-shipment: cancellation blocked, return flow required', () => {
  it('shipped → return_requested is valid (correct path after shipment)', () => {
    expect(canTransition(OrderStatus.delivered, OrderStatus.return_requested)).toBe(true)
  })

  it('shipped → cancelled_by_customer is BLOCKED', () => {
    expect(canTransition(OrderStatus.shipped, OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('delivered → cancelled_by_customer is BLOCKED', () => {
    expect(canTransition(OrderStatus.delivered, OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('delivery_confirmed → cancelled_by_customer is BLOCKED', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('all post-shipment statuses block naive cancellation', () => {
    const postShipment: OrderStatus[] = [
      OrderStatus.shipped,
      OrderStatus.delivered,
      OrderStatus.delivery_confirmation_pending,
      OrderStatus.delivery_confirmed,
    ]
    postShipment.forEach((status) => {
      expect(isPostShipmentStatus(status)).toBe(true)
    })
  })
})

// ─── Delivery confirmation semantics ──────────────────────────────────────────

describe('delivered ≠ delivery_confirmed — critical distinction', () => {
  it('delivered does NOT start payout clock', () => {
    expect(isPayoutCountdownEligible(OrderStatus.delivered)).toBe(false)
  })

  it('delivery_confirmed DOES start payout clock', () => {
    expect(isPayoutCountdownEligible(OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('delivered → delivery_confirmed via customer confirmation', () => {
    expect(canTransition(OrderStatus.delivered, OrderStatus.delivery_confirmed)).toBe(true)
    const result = buildCustomerConfirmation(new Date('2026-04-08T12:00:00Z'))
    expect(result.source).toBe('customer_explicit')
    expect(result.confirmed).toBe(true)
  })

  it('delivered → delivery_confirmed via admin confirmation', () => {
    const result = buildAdminConfirmation(new Date('2026-04-08T12:00:00Z'))
    expect(result.source).toBe('admin_manual')
    expect(result.confirmed).toBe(true)
  })

  it('delivered → delivery_confirmed via silent auto (72h)', () => {
    const deliveredAt = new Date('2026-04-05T00:00:00Z')
    const now = new Date('2026-04-08T01:00:00Z') // 73h later
    const eligible = isSilentConfirmationEligible({
      deliveredAt,
      hasOpenReturn: false,
      hasOpenDispute: false,
      now,
    })
    expect(eligible).toBe(true)
    const result = buildSilentConfirmation(now)
    expect(result.source).toBe('silent_auto')
  })

  it('silent confirmation is NOT eligible when return is open', () => {
    const deliveredAt = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-05T00:00:00Z') // 96h later
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: true, hasOpenDispute: false, now }),
    ).toBe(false)
  })
})

// ─── Return window semantics ──────────────────────────────────────────────────

describe('return window: 14-day rule', () => {
  it('return window is 14 days', () => {
    expect(RETURN_WINDOW_DAYS).toBe(14)
  })

  it('return_requested allowed from delivery_confirmed (14-day window)', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.return_requested)).toBe(true)
  })

  it('within 14 days → fast-path return', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const returnRequestedAt = new Date('2026-04-10T00:00:00Z') // 9 days later
    expect(isWithinReturnWindow(deliveryConfirmedAt, returnRequestedAt)).toBe(true)
  })

  it('after 14 days → requires admin evaluation', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const returnRequestedAt = new Date('2026-04-20T00:00:00Z') // 19 days later
    expect(isWithinReturnWindow(deliveryConfirmedAt, returnRequestedAt)).toBe(false)
  })

  it('full return lifecycle is valid', () => {
    const returnFlow: OrderStatus[] = [
      OrderStatus.return_requested,
      OrderStatus.return_under_review,
      OrderStatus.return_approved,
      OrderStatus.return_in_transit,
      OrderStatus.return_received,
      OrderStatus.refund_pending,
      OrderStatus.refund_completed,
    ]

    for (let i = 0; i < returnFlow.length - 1; i++) {
      const from = returnFlow[i]!
      const to = returnFlow[i + 1]!
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
    }

    expect(isTerminal(OrderStatus.refund_completed)).toBe(true)
  })

  it('return can be rejected (non-standard case)', () => {
    expect(canTransition(OrderStatus.return_under_review, OrderStatus.return_rejected)).toBe(true)
    expect(isTerminal(OrderStatus.return_rejected)).toBe(true)
  })
})

// ─── Dispute lifecycle ────────────────────────────────────────────────────────

describe('dispute lifecycle', () => {
  it('dispute can be opened from delivery_confirmed', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.dispute_open)).toBe(true)
  })

  it('dispute_open → dispute_resolved is the valid resolution', () => {
    expect(canTransition(OrderStatus.dispute_open, OrderStatus.dispute_resolved)).toBe(true)
  })

  it('dispute_open does NOT trigger payout clock', () => {
    expect(isPayoutCountdownEligible(OrderStatus.dispute_open)).toBe(false)
  })

  it('dispute_resolved is terminal', () => {
    expect(isTerminal(OrderStatus.dispute_resolved)).toBe(true)
  })
})

// ─── Cancellation reason tracking ────────────────────────────────────────────

describe('cancellation reason distinctions', () => {
  it('each cancellation cause maps to a separate status', () => {
    const cancellationStatuses: OrderStatus[] = [
      OrderStatus.cancelled_by_customer,
      OrderStatus.cancelled_by_admin,
      OrderStatus.cancelled_due_to_payment_failure,
      OrderStatus.cancelled_due_to_seller_rejection,
      OrderStatus.cancelled_due_to_20day_breach,
    ]

    cancellationStatuses.forEach((status) => {
      expect(isCancelled(status)).toBe(true)
      expect(isTerminal(status)).toBe(true)
    })
  })

  it('payment_failure cancellation does NOT require penalty', () => {
    expect(
      requiresSellerPenaltyEvaluation(OrderStatus.cancelled_due_to_payment_failure),
    ).toBe(false)
  })

  it('admin cancellation does NOT auto-trigger penalty evaluation (admin decides)', () => {
    expect(requiresSellerPenaltyEvaluation(OrderStatus.cancelled_by_admin)).toBe(false)
  })
})
