/**
 * Mock @prisma/client for unit/integration tests.
 * Mirrors enum values from db/schema/schema.prisma exactly.
 * No DB connection — enums only.
 */

export enum OrderStatus {
  draft = 'draft',
  checkout_started = 'checkout_started',
  payment_pending = 'payment_pending',
  bank_transfer_waiting = 'bank_transfer_waiting',
  bank_transfer_confirmed = 'bank_transfer_confirmed',
  payment_confirmed = 'payment_confirmed',
  payment_failed = 'payment_failed',
  payment_cancelled = 'payment_cancelled',
  seller_queue_ready = 'seller_queue_ready',
  seller_reviewing = 'seller_reviewing',
  seller_accepted = 'seller_accepted',
  seller_rejected = 'seller_rejected',
  preparing = 'preparing',
  awaiting_shipment = 'awaiting_shipment',
  shipped = 'shipped',
  delivered = 'delivered',
  delivery_confirmation_pending = 'delivery_confirmation_pending',
  delivery_confirmed = 'delivery_confirmed',
  cancelled_by_customer = 'cancelled_by_customer',
  cancelled_by_admin = 'cancelled_by_admin',
  cancelled_due_to_payment_failure = 'cancelled_due_to_payment_failure',
  cancelled_due_to_seller_rejection = 'cancelled_due_to_seller_rejection',
  cancelled_due_to_20day_breach = 'cancelled_due_to_20day_breach',
  return_requested = 'return_requested',
  return_under_review = 'return_under_review',
  return_approved = 'return_approved',
  return_rejected = 'return_rejected',
  return_in_transit = 'return_in_transit',
  return_received = 'return_received',
  refund_pending = 'refund_pending',
  refund_completed = 'refund_completed',
  dispute_open = 'dispute_open',
  dispute_resolved = 'dispute_resolved',
}

export enum PayoutStatus {
  hold_active = 'hold_active',
  payout_blocked = 'payout_blocked',
  payout_ready = 'payout_ready',
  payout_scheduled = 'payout_scheduled',
  payout_paid = 'payout_paid',
}

export enum PenaltyStatus {
  pending = 'pending',
  applied = 'applied',
  waived = 'waived',
  reversed = 'reversed',
}

export enum UserRole {
  customer = 'customer',
  seller = 'seller',
  admin = 'admin',
}

export enum SellerStatus {
  pending = 'pending',
  active = 'active',
  suspended = 'suspended',
  rejected = 'rejected',
}

export enum PaymentStatus {
  pending = 'pending',
  confirmed = 'confirmed',
  failed = 'failed',
  refunded = 'refunded',
  chargebacked = 'chargebacked',
  cancelled = 'cancelled',
}

export enum PaymentMethod {
  card = 'card',
  eft = 'eft',
}

// No-op PrismaClient — prevents accidental DB calls in unit tests
export class PrismaClient {
  constructor() {
    throw new Error(
      'PrismaClient must not be instantiated in unit tests. Use integration test setup instead.',
    )
  }
}
