/**
 * Order State Machine — 08-order-lifecycle-rules.md
 *
 * Defines all valid order status transitions. Every status change MUST go
 * through assertTransition() to prevent invalid lifecycle moves.
 *
 * Finance-critical invariants enforced here:
 * - delivered ≠ delivery_confirmed (payout starts only from delivery_confirmed)
 * - shipped orders do not fall back to naive cancellation
 * - seller only sees payment_confirmed+ orders (enforced in repositories)
 */
import { OrderStatus } from '@prisma/client'
import { InvalidTransitionError } from '../lib/errors'

// Explicit transition map. Terminal states have empty arrays.
const ALLOWED_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  draft: ['checkout_started'],
  checkout_started: ['payment_pending', 'payment_cancelled'],
  payment_pending: [
    'payment_confirmed',
    'payment_failed',
    'payment_cancelled',
    'bank_transfer_waiting',
  ],
  bank_transfer_waiting: ['bank_transfer_confirmed', 'payment_cancelled', 'cancelled_by_customer', 'cancelled_by_admin'],
  bank_transfer_confirmed: ['payment_confirmed'],
  payment_confirmed: ['seller_queue_ready', 'cancelled_by_customer', 'cancelled_by_admin'],
  payment_failed: ['payment_pending'], // Allow retry
  payment_cancelled: [], // Terminal

  // Seller fulfillment
  seller_queue_ready: ['seller_reviewing', 'seller_accepted', 'seller_rejected', 'cancelled_due_to_20day_breach', 'cancelled_by_customer', 'cancelled_by_admin'],
  seller_reviewing: ['seller_accepted', 'seller_rejected', 'cancelled_due_to_20day_breach', 'cancelled_by_customer', 'cancelled_by_admin'],
  seller_accepted: ['preparing', 'cancelled_due_to_20day_breach', 'cancelled_by_customer', 'cancelled_by_admin'],
  seller_rejected: ['cancelled_due_to_seller_rejection'],
  preparing: ['awaiting_shipment', 'cancelled_due_to_20day_breach', 'cancelled_by_customer', 'cancelled_by_admin'],
  awaiting_shipment: ['shipped', 'cancelled_due_to_20day_breach', 'cancelled_by_customer', 'cancelled_by_admin'],

  // Delivery — delivered ≠ delivery_confirmed
  shipped: ['delivered'],
  delivered: ['delivery_confirmation_pending', 'delivery_confirmed', 'return_requested'],
  delivery_confirmation_pending: ['delivery_confirmed', 'return_requested'],
  delivery_confirmed: ['return_requested', 'dispute_open'], // 14-day window still open

  // Return flow — seller-driven fast path (08-order-lifecycle-rules.md).
  // requested → approved: seller provides return cargo info (no admin review on fast path).
  // return_under_review kept for admin-override path.
  return_requested: ['return_approved', 'return_under_review'],
  return_under_review: ['return_approved', 'return_rejected'],
  return_approved: ['return_in_transit'],
  // in_transit → rejected: seller rejects the physically received item (wrong/damaged).
  return_in_transit: ['return_received', 'return_rejected'],
  // rejected → dispute_open: seller rejection auto-escalates to an admin dispute.
  return_rejected: ['dispute_open'],
  return_received: ['refund_pending'],
  refund_pending: ['refund_completed'],
  refund_completed: [], // Terminal

  // Dispute (can be opened from delivery_confirmed or alongside return)
  dispute_open: ['dispute_resolved'],
  dispute_resolved: [], // Terminal

  // Cancellations — all terminal
  cancelled_by_customer: [],
  cancelled_by_admin: [],
  cancelled_due_to_payment_failure: [],
  cancelled_due_to_seller_rejection: [],
  cancelled_due_to_20day_breach: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[from]
  return Array.isArray(allowed) && allowed.includes(to)
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to)
  }
}

export function isTerminal(status: OrderStatus): boolean {
  const allowed = ALLOWED_TRANSITIONS[status]
  return Array.isArray(allowed) && allowed.length === 0
}

export function isCancelled(status: OrderStatus): boolean {
  return (
    status === 'cancelled_by_customer' ||
    status === 'cancelled_by_admin' ||
    status === 'cancelled_due_to_payment_failure' ||
    status === 'cancelled_due_to_seller_rejection' ||
    status === 'cancelled_due_to_20day_breach'
  )
}

/** Payout countdown starts only from delivery_confirmed — never from delivered */
export function isPayoutCountdownEligible(status: OrderStatus): boolean {
  return status === 'delivery_confirmed'
}

/** Penalty applies on seller rejection and 20-day breach */
export function requiresSellerPenaltyEvaluation(status: OrderStatus): boolean {
  return (
    status === 'cancelled_due_to_seller_rejection' ||
    status === 'cancelled_due_to_20day_breach'
  )
}

/** After shipment, cancellation path is no longer available — use return/dispute */
export function isPostShipmentStatus(status: OrderStatus): boolean {
  const postShipment: OrderStatus[] = [
    'shipped',
    'delivered',
    'delivery_confirmation_pending',
    'delivery_confirmed',
    'return_requested',
    'return_under_review',
    'return_approved',
    'return_rejected',
    'return_in_transit',
    'return_received',
    'refund_pending',
    'refund_completed',
    'dispute_open',
    'dispute_resolved',
  ]
  return postShipment.includes(status)
}

/** Seller-visible: only payment_confirmed and beyond fulfillment states */
export function isSellerVisible(status: OrderStatus): boolean {
  const sellerVisible: OrderStatus[] = [
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'seller_rejected',
    'preparing',
    'awaiting_shipment',
    'shipped',
    'delivered',
    'delivery_confirmation_pending',
    'delivery_confirmed',
    'return_requested',
    'return_under_review',
    'return_approved',
    'return_in_transit',
    'return_received',
    'return_rejected',
    'dispute_open',
  ]
  return sellerVisible.includes(status)
}
