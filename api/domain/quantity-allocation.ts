import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'

/**
 * Allocates a money snapshot over an immutable original quantity.
 * Using cumulative boundaries guarantees that repeated partial operations add
 * up to the exact two-decimal snapshot without penny drift.
 */
export function allocateQuantitySlice(params: {
  totalAmount: Decimal
  originalQuantity: number
  consumedQuantity: number
  requestedQuantity: number
}) {
  const { totalAmount, originalQuantity, consumedQuantity, requestedQuantity } = params
  if (!Number.isInteger(originalQuantity) || originalQuantity <= 0) {
    throw new Error('originalQuantity must be a positive integer')
  }
  if (
    !Number.isInteger(consumedQuantity) ||
    !Number.isInteger(requestedQuantity) ||
    consumedQuantity < 0 ||
    requestedQuantity <= 0 ||
    consumedQuantity + requestedQuantity > originalQuantity
  ) {
    throw new Error('quantity slice exceeds the original quantity')
  }

  const before = roundMoney(totalAmount.mul(consumedQuantity).div(originalQuantity))
  const after = roundMoney(
    totalAmount.mul(consumedQuantity + requestedQuantity).div(originalQuantity),
  )
  return roundMoney(after.sub(before))
}

/** Allocate independent financial components; derive seller net after rounding. */
export function allocateProductRefund(
  line: {
    quantity: number
    totalPrice: Decimal
    customerPaidProductAmount?: Decimal | null
    couponDiscountAmount: Decimal
    commissionAmount: Decimal
    commissionExemptedAt?: Date | null
  },
  consumedQuantity: number,
  requestedQuantity: number,
) {
  const slice = (totalAmount: Decimal) =>
    allocateQuantitySlice({
      totalAmount,
      originalQuantity: line.quantity,
      consumedQuantity,
      requestedQuantity,
    })
  const grossAmount = slice(line.totalPrice)
  const couponAmount = slice(line.couponDiscountAmount)
  const commissionAmount = line.commissionExemptedAt ? new Decimal(0) : slice(line.commissionAmount)
  return {
    customerAmount: slice(line.customerPaidProductAmount ?? line.totalPrice),
    grossAmount,
    couponAmount,
    commissionAmount,
    sellerAmount: grossAmount.sub(couponAmount).sub(commissionAmount),
  }
}

export function quantityAvailable(params: {
  originalQuantity: number
  cancelledQuantity: number
  shippedQuantity?: number
  returnClaimedQuantity?: number
}) {
  return Math.max(
    0,
    params.originalQuantity -
      params.cancelledQuantity -
      (params.shippedQuantity ?? 0) -
      (params.returnClaimedQuantity ?? 0),
  )
}

export function isQuantityFullyClosed(params: {
  originalQuantity: number
  cancelledQuantity: number
  acceptedReturnQuantity: number
}) {
  return (
    params.originalQuantity > 0 &&
    params.originalQuantity === params.cancelledQuantity + params.acceptedReturnQuantity
  )
}
