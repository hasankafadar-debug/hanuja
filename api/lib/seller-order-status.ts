import type { OrderStatus, Prisma, SellerFulfillmentStatus } from '@prisma/client'

const FULFILLMENT_TO_ORDER = {
  queue_ready: 'seller_queue_ready',
  reviewing: 'seller_reviewing',
  accepted: 'seller_accepted',
} as const

export function sellerOperationalStatus(status: SellerFulfillmentStatus): string {
  return FULFILLMENT_TO_ORDER[status as keyof typeof FULFILLMENT_TO_ORDER] ?? status
}

/** V2 filters follow this designer's shipment, even when another designer shipped. */
export function sellerOrderStatusWhere(
  sellerId: string,
  statuses?: OrderStatus[],
): Prisma.OrderWhereInput {
  if (!statuses) return {}
  const fulfillmentStatuses = statuses.flatMap((status): SellerFulfillmentStatus[] => {
    if (status === 'seller_queue_ready') return ['queue_ready']
    if (status === 'seller_reviewing') return ['reviewing']
    if (status === 'seller_accepted') return ['accepted']
    if (status.startsWith('cancelled_') || status === 'seller_rejected') return ['cancelled']
    if (
      [
        'preparing',
        'awaiting_shipment',
        'shipped',
        'delivered',
        'delivery_confirmation_pending',
        'delivery_confirmed',
      ].includes(status)
    )
      return [status as SellerFulfillmentStatus]
    return []
  })
  return {
    OR: [
      { quantityLifecycleVersion: { not: 2 }, status: { in: statuses } },
      {
        quantityLifecycleVersion: 2,
        sellerFulfillments: { some: { sellerId, status: { in: fulfillmentStatuses } } },
      },
      {
        quantityLifecycleVersion: 2,
        sellerFulfillments: { none: { sellerId } },
        status: { in: statuses },
      },
    ],
  }
}
