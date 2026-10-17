import type { Prisma } from '@prisma/client'
import { ConflictError } from '../lib/errors'
import { lockProductStocks } from '../domain/product-stock'

type LineReleaseClient = Pick<
  Prisma.TransactionClient,
  'orderLine' | 'product' | 'productVariant' | 'orderSellerFulfillment' | '$queryRaw'
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
  if (!Number.isInteger(quantity) || quantity <= 0)
    throw new ConflictError('İptal miktarı pozitif tam sayı olmalıdır.')
  await lockProductStocks(tx, [line.productId])
  const updated = await tx.orderLine.updateMany({
    where: {
      id: line.id,
      cancelledQuantity: line.cancelledQuantity,
      shippedQuantity: line.shippedQuantity,
      quantity: {
        gte: quantity + line.cancelledQuantity + line.shippedQuantity,
      },
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
  }
  await tx.product.update({
    where: { id: line.productId },
    data: { stockQuantity: { increment: quantity } },
  })
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
 * Gives back the coupon use of an order that closes without a collected payment
 * (customer/admin cancellation before the EFT transfer is approved, EFT rejection,
 * an expired card payment): the CouponUsage row is deleted and Coupon.usageCount
 * drops by one. The delete is the claim — a repeated or concurrent call finds no
 * row and changes nothing, so the count drops exactly once. Paid orders keep their
 * coupon use when they are later cancelled or refunded; callers must not use this there.
 */
export async function releaseOrderCouponUsage(
  tx: Pick<Prisma.TransactionClient, 'couponUsage' | 'coupon'>,
  orderId: string,
) {
  const usage = await tx.couponUsage.findUnique({
    where: { orderId },
    select: { couponId: true },
  })
  if (!usage) return false
  const removed = await tx.couponUsage.deleteMany({ where: { orderId } })
  if (removed.count !== 1) return false
  await tx.coupon.updateMany({
    where: { id: usage.couponId, usageCount: { gt: 0 } },
    data: { usageCount: { decrement: 1 } },
  })
  return true
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
  await lockProductStocks(
    tx,
    lines.map((line) => line.productId),
  )
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
