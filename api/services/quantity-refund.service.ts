import type { PrismaClient, RefundSourceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError } from '../lib/errors'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'

export function createQuantityRefundService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  const ledger = createSellerLedgerRepository(prisma)

  async function queue(params: {
    orderId: string
    sellerId?: string
    sourceType: RefundSourceType
    sourceId: string
    customerAmount: Decimal
    sellerAdjustmentAmount: Decimal
    commissionAdjustmentAmount?: Decimal
    platformFundedAmount?: Decimal
  }) {
    const payment = await prisma.payment.findFirst({
      where: { orderId: params.orderId, status: 'confirmed' },
      orderBy: { confirmedAt: 'desc' },
    })

    const commissionAdjustmentAmount =
      params.commissionAdjustmentAmount ?? new Decimal(0)
    const platformFundedAmount = params.platformFundedAmount ?? new Decimal(0)

    return prisma.$transaction(async (tx) => {
      let refund = await tx.refundTransaction.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: params.sourceType,
            sourceId: params.sourceId,
          },
        },
      })
      if (!refund) {
        refund = await tx.refundTransaction.create({
          data: {
            orderId: params.orderId,
            ...(payment ? { paymentId: payment.id } : {}),
            ...(params.sellerId ? { sellerId: params.sellerId } : {}),
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            customerAmount: params.customerAmount,
            sellerAdjustmentAmount: params.sellerAdjustmentAmount,
            commissionAdjustmentAmount,
            platformFundedAmount,
            status: 'pending',
          },
        })
      } else if (
        refund.orderId !== params.orderId ||
        refund.sellerId !== (params.sellerId ?? null) ||
        !refund.customerAmount.equals(params.customerAmount) ||
        !refund.sellerAdjustmentAmount.equals(params.sellerAdjustmentAmount) ||
        !refund.commissionAdjustmentAmount.equals(commissionAdjustmentAmount)
      ) {
        throw new ConflictError(
          'Aynı iade anahtarı farklı finansal bilgilerle kullanılamaz',
        )
      }

      if (
        refund.sellerId &&
        refund.sellerAdjustmentAmount.gt(0) &&
        !refund.accountingAppliedAt
      ) {
        const claimed = await tx.refundTransaction.updateMany({
          where: { id: refund.id, accountingAppliedAt: null },
          data: { accountingAppliedAt: new Date() },
        })
        if (claimed.count === 1) {
          const payout = await tx.payout.findFirst({
            where: { orderId: refund.orderId, sellerId: refund.sellerId },
          })
          const grossRefundAdjustment = refund.sellerAdjustmentAmount.add(
            refund.commissionAdjustmentAmount,
          )
          if (payout) {
            await tx.payout.update({
              where: { id: payout.id },
              data: {
                refundAmount: { increment: grossRefundAdjustment },
                commissionAmount: Decimal.max(
                  new Decimal(0),
                  payout.commissionAmount.sub(
                    refund.commissionAdjustmentAmount,
                  ),
                ),
                netAmount: Decimal.max(
                  new Decimal(0),
                  payout.netAmount.sub(refund.sellerAdjustmentAmount),
                ),
              },
            })
          }

          const ledgerAmount = payout
            ? refund.sellerAdjustmentAmount
            : grossRefundAdjustment
          await ledger.createEntry(
            {
              sellerId: refund.sellerId,
              type: 'refund',
              amount: ledgerAmount.negated(),
              referenceType: 'refund_transaction',
              referenceId: refund.id,
              orderId: refund.orderId,
              description: `Adet bazlı iade düzeltmesi — ${ledgerAmount.toFixed(2)} TRY`,
              visibleToSeller: true,
            },
            tx as unknown as PrismaClient,
          )
        }
      }

      return tx.refundTransaction.findUniqueOrThrow({
        where: { id: refund.id },
      })
    })
  }

  async function complete(params: {
    refundTransactionId: string
    actorId: string
    providerReference: string
  }) {
    if (!params.providerReference.trim())
      throw new ConflictError('İade işlem referansı gerekli')

    return prisma.$transaction(async (tx) => {
      const refund = await tx.refundTransaction.findUnique({
        where: { id: params.refundTransactionId },
      })
      if (!refund)
        throw new NotFoundError('RefundTransaction', params.refundTransactionId)
      if (refund.status === 'completed') return refund

      const claimed = await tx.refundTransaction.updateMany({
        where: { id: refund.id, status: { not: 'completed' } },
        data: {
          status: 'completed',
          providerReference: params.providerReference.trim(),
          completedAt: new Date(),
          failureReason: null,
        },
      })
      if (claimed.count !== 1) {
        return tx.refundTransaction.findUniqueOrThrow({
          where: { id: refund.id },
        })
      }
      const completed = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: refund.id },
      })
      if (refund.paymentId) {
        const payment = await tx.payment.update({
          where: { id: refund.paymentId },
          data: { refundedAmount: { increment: refund.customerAmount } },
        })
        if (payment.refundedAmount.gte(payment.amount)) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded', refundedAt: new Date() },
          })
        }
      }
      if (refund.sourceType === 'cancellation') {
        await tx.orderCancellation.update({
          where: { id: refund.sourceId },
          data: { status: 'completed' },
        })
      } else if (refund.sourceType === 'return_request') {
        await tx.returnRequest.update({
          where: { id: refund.sourceId },
          data: {
            status: 'refund_completed',
            refundedAt: new Date(),
            refundAmount: refund.customerAmount,
          },
        })
      }
      await tx.adminAuditLog.create({
        data: {
          actorId: params.actorId,
          actionType: 'manual_ledger_adjustment',
          targetType: 'refund_transaction',
          targetId: refund.id,
          newData: {
            status: 'completed',
            providerReference: params.providerReference.trim(),
          },
          reason: 'Sağlayıcı/banka iade işlemi tamamlandı',
        },
      })
      return completed
    })
  }

  return { queue, complete }
}

export type QuantityRefundService = ReturnType<
  typeof createQuantityRefundService
>
