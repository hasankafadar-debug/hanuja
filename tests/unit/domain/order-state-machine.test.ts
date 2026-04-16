/**
 * Unit tests — order-state-machine.ts
 * All valid/invalid transitions. Finance-critical invariants.
 * 08-order-lifecycle-rules.md
 */
import { describe, it, expect } from 'vitest'
import { OrderStatus } from '../../__mocks__/prisma-client'
import {
  canTransition,
  assertTransition,
  isTerminal,
  isCancelled,
  isPayoutCountdownEligible,
  requiresSellerPenaltyEvaluation,
  isPostShipmentStatus,
  isSellerVisible,
} from '../../../api/domain/order-state-machine'

// ─── canTransition — valid paths ─────────────────────────────────────────────

describe('canTransition — valid happy-path transitions', () => {
  it('draft → checkout_started', () => {
    expect(canTransition(OrderStatus.draft, OrderStatus.checkout_started)).toBe(true)
  })

  it('checkout_started → payment_pending', () => {
    expect(canTransition(OrderStatus.checkout_started, OrderStatus.payment_pending)).toBe(true)
  })

  it('payment_pending → payment_confirmed', () => {
    expect(canTransition(OrderStatus.payment_pending, OrderStatus.payment_confirmed)).toBe(true)
  })

  it('payment_pending → bank_transfer_waiting', () => {
    expect(canTransition(OrderStatus.payment_pending, OrderStatus.bank_transfer_waiting)).toBe(true)
  })

  it('bank_transfer_waiting → bank_transfer_confirmed', () => {
    expect(
      canTransition(OrderStatus.bank_transfer_waiting, OrderStatus.bank_transfer_confirmed),
    ).toBe(true)
  })

  it('bank_transfer_confirmed → payment_confirmed', () => {
    expect(
      canTransition(OrderStatus.bank_transfer_confirmed, OrderStatus.payment_confirmed),
    ).toBe(true)
  })

  it('payment_confirmed → seller_queue_ready', () => {
    expect(canTransition(OrderStatus.payment_confirmed, OrderStatus.seller_queue_ready)).toBe(true)
  })

  it('seller_queue_ready → seller_accepted', () => {
    expect(canTransition(OrderStatus.seller_queue_ready, OrderStatus.seller_accepted)).toBe(true)
  })

  it('seller_accepted → preparing', () => {
    expect(canTransition(OrderStatus.seller_accepted, OrderStatus.preparing)).toBe(true)
  })

  it('preparing → awaiting_shipment', () => {
    expect(canTransition(OrderStatus.preparing, OrderStatus.awaiting_shipment)).toBe(true)
  })

  it('awaiting_shipment → shipped', () => {
    expect(canTransition(OrderStatus.awaiting_shipment, OrderStatus.shipped)).toBe(true)
  })

  it('shipped → delivered', () => {
    expect(canTransition(OrderStatus.shipped, OrderStatus.delivered)).toBe(true)
  })

  it('delivered → delivery_confirmation_pending', () => {
    expect(
      canTransition(OrderStatus.delivered, OrderStatus.delivery_confirmation_pending),
    ).toBe(true)
  })

  it('delivered → delivery_confirmed (silent / admin path)', () => {
    expect(canTransition(OrderStatus.delivered, OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('delivery_confirmation_pending → delivery_confirmed', () => {
    expect(
      canTransition(OrderStatus.delivery_confirmation_pending, OrderStatus.delivery_confirmed),
    ).toBe(true)
  })

  it('delivery_confirmed → return_requested (14-day window)', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.return_requested)).toBe(true)
  })

  it('delivery_confirmed → dispute_open', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.dispute_open)).toBe(true)
  })

  it('return_requested → return_under_review', () => {
    expect(canTransition(OrderStatus.return_requested, OrderStatus.return_under_review)).toBe(true)
  })

  it('return_under_review → return_approved', () => {
    expect(canTransition(OrderStatus.return_under_review, OrderStatus.return_approved)).toBe(true)
  })

  it('return_approved → return_in_transit', () => {
    expect(canTransition(OrderStatus.return_approved, OrderStatus.return_in_transit)).toBe(true)
  })

  it('return_in_transit → return_received', () => {
    expect(canTransition(OrderStatus.return_in_transit, OrderStatus.return_received)).toBe(true)
  })

  it('return_received → refund_pending', () => {
    expect(canTransition(OrderStatus.return_received, OrderStatus.refund_pending)).toBe(true)
  })

  it('refund_pending → refund_completed', () => {
    expect(canTransition(OrderStatus.refund_pending, OrderStatus.refund_completed)).toBe(true)
  })

  it('dispute_open → dispute_resolved', () => {
    expect(canTransition(OrderStatus.dispute_open, OrderStatus.dispute_resolved)).toBe(true)
  })

  it('seller_rejected → cancelled_due_to_seller_rejection', () => {
    expect(
      canTransition(OrderStatus.seller_rejected, OrderStatus.cancelled_due_to_seller_rejection),
    ).toBe(true)
  })

  it('awaiting_shipment → cancelled_due_to_20day_breach', () => {
    expect(
      canTransition(OrderStatus.awaiting_shipment, OrderStatus.cancelled_due_to_20day_breach),
    ).toBe(true)
  })

  it('payment_failed → payment_pending (retry)', () => {
    expect(canTransition(OrderStatus.payment_failed, OrderStatus.payment_pending)).toBe(true)
  })
})

// ─── canTransition — BLOCKED finance-critical invariants ──────────────────────

describe('canTransition — blocked invalid transitions (finance invariants)', () => {
  it('BLOCKS: shipped → delivery_confirmed (must go through delivered first)', () => {
    expect(canTransition(OrderStatus.shipped, OrderStatus.delivery_confirmed)).toBe(false)
  })

  it('BLOCKS: delivered → cancelled_by_customer (shipped → return/refund, not cancellation)', () => {
    expect(canTransition(OrderStatus.delivered, OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('BLOCKS: shipped → cancelled_by_customer (post-shipment cancellation path closed)', () => {
    expect(canTransition(OrderStatus.shipped, OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('BLOCKS: payment_pending → seller_queue_ready (must confirm payment first)', () => {
    expect(canTransition(OrderStatus.payment_pending, OrderStatus.seller_queue_ready)).toBe(false)
  })

  it('BLOCKS: seller_queue_ready → shipped (must accept and prepare first)', () => {
    expect(canTransition(OrderStatus.seller_queue_ready, OrderStatus.shipped)).toBe(false)
  })

  it('BLOCKS: draft → payment_confirmed (skipping payment flow)', () => {
    expect(canTransition(OrderStatus.draft, OrderStatus.payment_confirmed)).toBe(false)
  })

  it('BLOCKS: delivery_confirmed → payment_confirmed (backwards)', () => {
    expect(canTransition(OrderStatus.delivery_confirmed, OrderStatus.payment_confirmed)).toBe(false)
  })

  it('BLOCKS: refund_completed → anything (terminal)', () => {
    expect(canTransition(OrderStatus.refund_completed, OrderStatus.return_requested)).toBe(false)
    expect(canTransition(OrderStatus.refund_completed, OrderStatus.draft)).toBe(false)
  })

  it('BLOCKS: cancelled_due_to_seller_rejection → anything (terminal)', () => {
    expect(
      canTransition(OrderStatus.cancelled_due_to_seller_rejection, OrderStatus.draft),
    ).toBe(false)
  })

  it('BLOCKS: payment_cancelled → anything (terminal)', () => {
    expect(canTransition(OrderStatus.payment_cancelled, OrderStatus.payment_pending)).toBe(false)
  })
})

// ─── assertTransition ─────────────────────────────────────────────────────────

describe('assertTransition', () => {
  it('does not throw for valid transitions', () => {
    expect(() =>
      assertTransition(OrderStatus.draft, OrderStatus.checkout_started),
    ).not.toThrow()
  })

  it('throws InvalidTransitionError for invalid transitions', () => {
    expect(() =>
      assertTransition(OrderStatus.shipped, OrderStatus.cancelled_by_customer),
    ).toThrow()
  })

  it('thrown error message describes the attempted transition', () => {
    let errorMessage = ''
    try {
      assertTransition(OrderStatus.delivery_confirmed, OrderStatus.draft)
    } catch (e: unknown) {
      errorMessage = (e as Error).message
    }
    expect(errorMessage).toContain('delivery_confirmed')
    expect(errorMessage).toContain('draft')
  })
})

// ─── isTerminal ───────────────────────────────────────────────────────────────

describe('isTerminal', () => {
  const terminals: OrderStatus[] = [
    OrderStatus.payment_cancelled,
    OrderStatus.refund_completed,
    OrderStatus.return_rejected,
    OrderStatus.dispute_resolved,
    OrderStatus.cancelled_by_customer,
    OrderStatus.cancelled_by_admin,
    OrderStatus.cancelled_due_to_payment_failure,
    OrderStatus.cancelled_due_to_seller_rejection,
    OrderStatus.cancelled_due_to_20day_breach,
  ]

  terminals.forEach((status) => {
    it(`${status} is terminal`, () => {
      expect(isTerminal(status)).toBe(true)
    })
  })

  it('delivery_confirmed is NOT terminal (return window still open)', () => {
    expect(isTerminal(OrderStatus.delivery_confirmed)).toBe(false)
  })

  it('draft is NOT terminal', () => {
    expect(isTerminal(OrderStatus.draft)).toBe(false)
  })
})

// ─── isCancelled ──────────────────────────────────────────────────────────────

describe('isCancelled', () => {
  it('identifies all cancellation statuses', () => {
    expect(isCancelled(OrderStatus.cancelled_by_customer)).toBe(true)
    expect(isCancelled(OrderStatus.cancelled_by_admin)).toBe(true)
    expect(isCancelled(OrderStatus.cancelled_due_to_payment_failure)).toBe(true)
    expect(isCancelled(OrderStatus.cancelled_due_to_seller_rejection)).toBe(true)
    expect(isCancelled(OrderStatus.cancelled_due_to_20day_breach)).toBe(true)
  })

  it('non-cancellation statuses return false', () => {
    expect(isCancelled(OrderStatus.payment_confirmed)).toBe(false)
    expect(isCancelled(OrderStatus.shipped)).toBe(false)
    expect(isCancelled(OrderStatus.refund_completed)).toBe(false)
  })
})

// ─── isPayoutCountdownEligible ────────────────────────────────────────────────

describe('isPayoutCountdownEligible — CRITICAL: only delivery_confirmed', () => {
  it('returns true ONLY for delivery_confirmed', () => {
    expect(isPayoutCountdownEligible(OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('returns false for delivered (not the same!)', () => {
    expect(isPayoutCountdownEligible(OrderStatus.delivered)).toBe(false)
  })

  it('returns false for shipped', () => {
    expect(isPayoutCountdownEligible(OrderStatus.shipped)).toBe(false)
  })

  it('returns false for payment_confirmed', () => {
    expect(isPayoutCountdownEligible(OrderStatus.payment_confirmed)).toBe(false)
  })

  it('returns false for all cancellation statuses', () => {
    expect(isPayoutCountdownEligible(OrderStatus.cancelled_by_customer)).toBe(false)
    expect(isPayoutCountdownEligible(OrderStatus.cancelled_due_to_seller_rejection)).toBe(false)
  })
})

// ─── requiresSellerPenaltyEvaluation ─────────────────────────────────────────

describe('requiresSellerPenaltyEvaluation — CLAUDE.md §2.4', () => {
  it('returns true for seller rejection', () => {
    expect(
      requiresSellerPenaltyEvaluation(OrderStatus.cancelled_due_to_seller_rejection),
    ).toBe(true)
  })

  it('returns true for 20-day breach cancellation', () => {
    expect(
      requiresSellerPenaltyEvaluation(OrderStatus.cancelled_due_to_20day_breach),
    ).toBe(true)
  })

  it('returns false for customer cancellation', () => {
    expect(requiresSellerPenaltyEvaluation(OrderStatus.cancelled_by_customer)).toBe(false)
  })

  it('returns false for admin cancellation (waiver may still apply)', () => {
    expect(requiresSellerPenaltyEvaluation(OrderStatus.cancelled_by_admin)).toBe(false)
  })

  it('returns false for normal delivery_confirmed', () => {
    expect(requiresSellerPenaltyEvaluation(OrderStatus.delivery_confirmed)).toBe(false)
  })
})

// ─── isPostShipmentStatus ─────────────────────────────────────────────────────

describe('isPostShipmentStatus — no naive cancellation after shipment', () => {
  const postShipment: OrderStatus[] = [
    OrderStatus.shipped,
    OrderStatus.delivered,
    OrderStatus.delivery_confirmation_pending,
    OrderStatus.delivery_confirmed,
    OrderStatus.return_requested,
    OrderStatus.return_under_review,
    OrderStatus.return_approved,
    OrderStatus.return_rejected,
    OrderStatus.return_in_transit,
    OrderStatus.return_received,
    OrderStatus.refund_pending,
    OrderStatus.refund_completed,
    OrderStatus.dispute_open,
    OrderStatus.dispute_resolved,
  ]

  postShipment.forEach((status) => {
    it(`${status} is post-shipment`, () => {
      expect(isPostShipmentStatus(status)).toBe(true)
    })
  })

  it('seller_accepted is NOT post-shipment', () => {
    expect(isPostShipmentStatus(OrderStatus.seller_accepted)).toBe(false)
  })

  it('payment_confirmed is NOT post-shipment', () => {
    expect(isPostShipmentStatus(OrderStatus.payment_confirmed)).toBe(false)
  })
})

// ─── isSellerVisible ──────────────────────────────────────────────────────────

describe('isSellerVisible — seller must not see unpaid orders', () => {
  it('seller_queue_ready is visible (payment already confirmed)', () => {
    expect(isSellerVisible(OrderStatus.seller_queue_ready)).toBe(true)
  })

  it('shipped is visible', () => {
    expect(isSellerVisible(OrderStatus.shipped)).toBe(true)
  })

  it('delivery_confirmed is visible', () => {
    expect(isSellerVisible(OrderStatus.delivery_confirmed)).toBe(true)
  })

  it('draft is NOT visible to seller', () => {
    expect(isSellerVisible(OrderStatus.draft)).toBe(false)
  })

  it('payment_pending is NOT visible to seller', () => {
    expect(isSellerVisible(OrderStatus.payment_pending)).toBe(false)
  })

  it('payment_confirmed is NOT visible (not yet in seller queue)', () => {
    expect(isSellerVisible(OrderStatus.payment_confirmed)).toBe(false)
  })

  it('bank_transfer_waiting is NOT visible to seller', () => {
    expect(isSellerVisible(OrderStatus.bank_transfer_waiting)).toBe(false)
  })

  it('payment_failed is NOT visible to seller', () => {
    expect(isSellerVisible(OrderStatus.payment_failed)).toBe(false)
  })
})
