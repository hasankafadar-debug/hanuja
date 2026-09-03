import { type Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { ConflictError } from '../lib/errors'

interface PaymentAccrualParams {
  prisma: PrismaClient
  tx: Prisma.TransactionClient
  orderId: string
  effectiveAt: Date
  actorId: string
}

/**
 * Posts seller-visible product accruals at payment confirmation.
 *
 * Seller-funded coupon share is a separate debit. Platform coupons and EFT
 * channel discounts never enter the seller ledger, so the accrual remains
 * independent from the customer's payment channel.
 */
export async function postPaymentConfirmedSellerAccruals({
  prisma,
  tx,
  orderId,
  effectiveAt,
  actorId,
}: PaymentAccrualParams) {
  const lines = await tx.orderLine.findMany({
    where: { orderId },
    select: {
      sellerId: true,
      totalPrice: true,
      couponDiscountAmount: true,
    },
  })
  if (lines.length === 0) {
    throw new ConflictError('Ödeme onayı için satıcı sipariş kalemi bulunamadı')
  }

  const bySeller = new Map<
    string,
    { grossProductAmount: Decimal; sellerCouponAmount: Decimal }
  >()
  for (const line of lines) {
    const current = bySeller.get(line.sellerId) ?? {
      grossProductAmount: new Decimal(0),
      sellerCouponAmount: new Decimal(0),
    }
    current.grossProductAmount = current.grossProductAmount.add(line.totalPrice)
    current.sellerCouponAmount = current.sellerCouponAmount.add(
      line.couponDiscountAmount,
    )
    bySeller.set(line.sellerId, current)
  }

  const ledger = createSellerLedgerRepository(prisma)
  for (const [sellerId, totals] of bySeller) {
    await ledger.createEntry(
      {
        sellerId,
        type: 'sale',
        amount: totals.grossProductAmount,
        eventKey: `payment-confirmed:sale:${orderId}:${sellerId}`,
        effectiveAt,
        referenceType: 'order',
        referenceId: orderId,
        description: 'Ödemesi onaylanan brüt ürün satışı',
        createdBy: actorId,
        visibleToSeller: true,
      },
      tx,
    )

    if (totals.sellerCouponAmount.gt(0)) {
      await ledger.createEntry(
        {
          sellerId,
          type: 'coupon_share',
          amount: totals.sellerCouponAmount.negated(),
          eventKey: `payment-confirmed:coupon-share:${orderId}:${sellerId}`,
          effectiveAt,
          referenceType: 'order',
          referenceId: orderId,
          description: 'Satıcı tarafından karşılanan kupon payı',
          createdBy: actorId,
          visibleToSeller: true,
        },
        tx,
      )
    }
  }
}
