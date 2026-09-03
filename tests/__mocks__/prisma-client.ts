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

export enum NotificationType {
  order_placed = 'order_placed',
  order_payment_confirmed = 'order_payment_confirmed',
  order_shipped = 'order_shipped',
  order_delivered = 'order_delivered',
  order_delivery_confirmed = 'order_delivery_confirmed',
  order_canceled = 'order_canceled',
  order_cancelled = 'order_cancelled',
  order_return_approved = 'order_return_approved',
  order_return_rejected = 'order_return_rejected',
  return_requested = 'return_requested',
  return_status_changed = 'return_status_changed',
  refund_completed = 'refund_completed',
  payout_ready = 'payout_ready',
  payout_paid = 'payout_paid',
  seller_order_received = 'seller_order_received',
  seller_payout_ready = 'seller_payout_ready',
  seller_payout_paid = 'seller_payout_paid',
  seller_penalty_applied = 'seller_penalty_applied',
  seller_return_request = 'seller_return_request',
  penalty_applied = 'penalty_applied',
  dispute_opened = 'dispute_opened',
  dispute_resolved = 'dispute_resolved',
  admin_bank_transfer_pending = 'admin_bank_transfer_pending',
  admin_dispute_opened = 'admin_dispute_opened',
  account_verified = 'account_verified',
  seller_approved = 'seller_approved',
  seller_suspended = 'seller_suspended',
  seller_bank_detail_pending = 'seller_bank_detail_pending',
  seller_bank_detail_approved = 'seller_bank_detail_approved',
  seller_bank_detail_activated = 'seller_bank_detail_activated',
  seller_bank_detail_blocked = 'seller_bank_detail_blocked',
  seller_support_reply = 'seller_support_reply',
  admin_support_new_ticket = 'admin_support_new_ticket',
  invoice_uploaded = 'invoice_uploaded',
  store_discount_followed_seller = 'store_discount_followed_seller',
  product_review_pending_moderation = 'product_review_pending_moderation',
  product_review_approved = 'product_review_approved',
  product_review_rejected = 'product_review_rejected',
  product_discount_favorited = 'product_discount_favorited',
  product_discount_in_cart = 'product_discount_in_cart',
}

export enum CampaignDispatchSource {
  favorite = 'favorite',
  cart = 'cart',
}

// No-op PrismaClient — prevents accidental DB calls in unit tests
export const Prisma = {
  JsonNull: null,
  sql(strings: TemplateStringsArray, ...values: unknown[]) {
    return { strings: Array.from(strings), values }
  },
}

export class PrismaClient {
  constructor() {
    throw new Error(
      'PrismaClient must not be instantiated in unit tests. Use integration test setup instead.',
    )
  }
}
