export const DELIVERY_REVIEW_STATUSES = [
  'shipped',
  'delivered',
  'delivery_confirmation_pending',
] as const

export type DeliveryReviewLine = {
  quantity: number
  cancelledQuantity: number
  shippedQuantity: number
  fulfilledAt: Date | null
  deliveryConfirmedAt: Date | null
}

/** A line confirmation covers its whole active quantity, never an unshipped unit. */
export function isDeliveryReviewLine(line: DeliveryReviewLine, lifecycleVersion: number): boolean {
  const activeQuantity = line.quantity - line.cancelledQuantity
  return (
    activeQuantity > 0 &&
    !line.deliveryConfirmedAt &&
    (lifecycleVersion === 2 ? line.shippedQuantity >= activeQuantity : line.fulfilledAt !== null)
  )
}
