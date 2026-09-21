import type { OrderStatus, SellerFulfillmentStatus } from '@prisma/client'

export const SELLER_APPROVAL_WAIT_MS = 24 * 60 * 60 * 1000

export type SellerApprovalCandidate = {
  id: string
  status: OrderStatus
  quantityLifecycleVersion: number
  sellerQueueReadyAt: Date | null
  paymentConfirmedAt: Date | null
  cancelledAt: Date | null
  lines: Array<{
    sellerId: string
    quantity: number
    cancelledQuantity: number
    shippedQuantity: number
  }>
  sellerFulfillments: Array<{
    sellerId: string
    status: SellerFulfillmentStatus
    acceptedAt: Date | null
  }>
}

const unpaidOrClosed: OrderStatus[] = [
  'draft', 'checkout_started', 'payment_pending', 'payment_failed',
  'payment_cancelled', 'bank_transfer_waiting', 'bank_transfer_confirmed',
  'seller_rejected', 'refund_completed',
  'cancelled_by_customer', 'cancelled_by_admin',
  'cancelled_due_to_payment_failure', 'cancelled_due_to_seller_rejection',
  'cancelled_due_to_20day_breach',
]

export const SELLER_APPROVAL_EXCLUDED_STATUSES = unpaidOrClosed

/** Payment method is deliberately irrelevant once the order reaches the seller queue. */
export function getOverdueSellerApproval(order: SellerApprovalCandidate, now: Date) {
  const waitingSince = order.sellerQueueReadyAt ?? order.paymentConfirmedAt
  if (
    !waitingSince || order.cancelledAt || unpaidOrClosed.includes(order.status) ||
    now.getTime() - waitingSince.getTime() < SELLER_APPROVAL_WAIT_MS
  ) return null

  const activeSellerIds = new Set(order.lines
    .filter((line) => line.quantity - line.cancelledQuantity - line.shippedQuantity > 0)
    .map((line) => line.sellerId))

  const sellerIds = order.quantityLifecycleVersion === 2
    ? order.sellerFulfillments
      .filter((fulfillment) =>
        (fulfillment.status === 'queue_ready' || fulfillment.status === 'reviewing') &&
        fulfillment.acceptedAt === null && activeSellerIds.has(fulfillment.sellerId))
      .map((fulfillment) => fulfillment.sellerId)
    : (order.status === 'seller_queue_ready' || order.status === 'seller_reviewing')
      ? [...activeSellerIds]
      : []

  if (sellerIds.length === 0) return null
  return { orderId: order.id, waitingSince, sellerIds: [...new Set(sellerIds)] }
}
