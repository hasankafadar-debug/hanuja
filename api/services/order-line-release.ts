import type { Prisma } from '@prisma/client'
import { ConflictError } from '../lib/errors'

type LineReleaseClient = Pick<
  Prisma.TransactionClient,
  'orderLine' | 'product' | 'productVariant' | 'orderSellerFulfillment'
>

interface ReleasableLine {
  id: string
  productId: string
  variantId: string | null
  cancelledQuantity: number
  shippedQuantity: number
}

/**
 * Cancels `quantity` units of one order line and returns them to stock.
 * Compare-and-swap on the counters the caller read, so a concurrent shipment or
 * cancellation fails this call instead of releasing stock twice.
 */
export async function releaseLineQuantity(
  tx: LineReleaseClient,
  line: ReleasableLine,
  quantity: number,
) {
  const updated = await tx.orderLine.updateMany({
    where: {
      id: line.id,
      cancelledQuantity: line.cancelledQuantity,
      shippedQuantity: line.shippedQuantity,
    },
    data: { cancelledQuantity: { increment: quantity } },
  })
  if (updated.count !== 1) {
    throw new ConflictError('Ürün kargoya verilmiş veya başka bir iptal işlemi yapılmış')
  }

  if (line.variantId) {
    await tx.productVariant.update({
      where: { id: line.variantId },
      data: { stockQuantity: { increment: quantity } },
    })
  } else {
    await tx.product.update({
      where: { id: line.productId },
      data: { stockQuantity: { increment: quantity } },
    })
  }
}

/** Marks a seller's shipment cancelled once every one of its lines is fully cancelled. */
export async function closeFullyCancelledSellerFulfillment(
  tx: LineReleaseClient,
  orderId: string,
  sellerId: string,
) {
  const sellerLines = await tx.orderLine.findMany({
    where: { orderId, sellerId },
    select: { quantity: true, cancelledQuantity: true },
  })
  if (
    sellerLines.length === 0 ||
    !sellerLines.every((line) => line.cancelledQuantity === line.quantity)
  ) {
    return
  }
  await tx.orderSellerFulfillment.updateMany({
    where: {
      orderId,
      sellerId,
      status: {
        notIn: ['shipped', 'delivered', 'delivery_confirmation_pending', 'delivery_confirmed'],
      },
    },
    data: { status: 'cancelled' },
  })
}

/**
 * Releases every unshipped unit of an order that never collected a payment
 * (EFT rejection, admin cancellation of an unpaid legacy order). No refund or
 * ledger effect: nothing was collected and no seller accrual exists.
 */
export async function releaseRemainingOrderLines(tx: LineReleaseClient, orderId: string) {
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: {
      id: true,
      sellerId: true,
      productId: true,
      variantId: true,
      quantity: true,
      cancelledQuantity: true,
      shippedQuantity: true,
    },
  })
  const sellerIds = new Set<string>()
  for (const line of lines) {
    const remaining = line.quantity - line.cancelledQuantity - line.shippedQuantity
    if (remaining <= 0) continue
    await releaseLineQuantity(tx, line, remaining)
    sellerIds.add(line.sellerId)
  }
  for (const sellerId of sellerIds) {
    await closeFullyCancelledSellerFulfillment(tx, orderId, sellerId)
  }
}
