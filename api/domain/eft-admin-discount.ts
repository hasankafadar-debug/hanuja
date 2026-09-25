import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'
import { allocateCouponDiscount } from './payout-calculator'

/**
 * Admin manual discount entered while approving a havale/EFT payment.
 *
 * Business rule (owner decision, 2026-09-25): the discount is absorbed by
 * Hanuja exactly like the EFT channel discount. It only lowers what the
 * customer pays for the products; shipping is never discounted and no
 * seller-side snapshot (totalPrice, couponDiscountAmount, commissionAmount,
 * netPayoutAmount) changes.
 *
 * The discount is spread over the lines proportionally to what the customer
 * currently pays for each line (`customerPaidProductAmount ?? totalPrice`) so
 * per-line refund caps keep matching the amount actually collected.
 */
export type EftAdminDiscountLine = {
  id: string
  totalPrice: Decimal
  customerPaidProductAmount: Decimal | null
}

export type EftAdminDiscountResolution =
  | {
      status: 'ok'
      paidProductTotal: Decimal
      lines: Array<{
        orderLineId: string
        previousPaidAmount: Decimal
        discountShare: Decimal
        newPaidAmount: Decimal
      }>
    }
  | { status: 'exceeds_paid_product_total'; paidProductTotal: Decimal }

export function resolveEftAdminDiscount(params: {
  lines: EftAdminDiscountLine[]
  discount: Decimal
  orderTotalAmount: Decimal
  shippingAmount: Decimal
}): EftAdminDiscountResolution {
  const zero = new Decimal(0)
  const bases = params.lines.map((line) => line.customerPaidProductAmount ?? line.totalPrice)
  const lineTotal = bases.reduce((sum, base) => sum.add(base), zero)
  // The order total minus shipping is what the customer owes for products.
  // Taking the smaller of the two keeps the cap safe for legacy orders whose
  // lines never carried a customer-paid snapshot.
  const paidProductTotal = Decimal.max(
    zero,
    Decimal.min(lineTotal, params.orderTotalAmount.sub(params.shippingAmount)),
  )
  if (params.discount.gt(paidProductTotal)) {
    return { status: 'exceeds_paid_product_total', paidProductTotal }
  }

  const shares = allocateCouponDiscount(
    bases.map((base) => ({ totalPrice: base })),
    params.discount,
  )
  return {
    status: 'ok',
    paidProductTotal,
    lines: params.lines.map((line, index) => {
      const previousPaidAmount = bases[index]!
      const discountShare = shares[index] ?? zero
      return {
        orderLineId: line.id,
        previousPaidAmount,
        discountShare,
        newPaidAmount: roundMoney(previousPaidAmount.sub(discountShare)),
      }
    }),
  }
}
