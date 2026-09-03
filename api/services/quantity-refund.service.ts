import type { PrismaClient, RefundSourceType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError } from '../lib/errors'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { enqueueRefundProcessing } from '../jobs/refund-processing.job'
import { enqueueRefundCompletedNotifications } from './refund-notification.service'

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
    grossProductAmount?: Decimal
    couponAdjustmentAmount?: Decimal
    sellerAdjustmentAmount: Decimal
    commissionAdjustmentAmount?: Decimal
    platformFundedAmount?: Decimal
    items?: Array<{ orderLineId: string; quantity: number; amount: Decimal }>
    shippingAmount?: Decimal
  }) {
    const payment = await prisma.payment.findFirst({
      where: { orderId: params.orderId, status: 'confirmed' },
      orderBy: { confirmedAt: 'desc' },
    })

    const commissionAdjustmentAmount =
      params.commissionAdjustmentAmount ?? new Decimal(0)
    const couponAdjustmentAmount =
      params.couponAdjustmentAmount ?? new Decimal(0)
    const grossProductAmount =
      params.grossProductAmount ??
      params.sellerAdjustmentAmount
        .add(commissionAdjustmentAmount)
        .add(couponAdjustmentAmount)
    const platformFundedAmount = params.platformFundedAmount ?? new Decimal(0)

    const requestedItems = [
      ...(params.items ?? []).map((item) => ({
        orderLineId: item.orderLineId,
        quantity: item.quantity,
        kind: 'product' as const,
        amount: item.amount,
      })),
      ...((params.shippingAmount?.gt(0) ?? false)
        ? [{ kind: 'shipping' as const, amount: params.shippingAmount! }]
        : []),
    ]
    if (
      requestedItems.length > 0 &&
      !requestedItems
        .reduce((sum, item) => sum.add(item.amount), new Decimal(0))
        .equals(params.customerAmount)
    ) {
      throw new ConflictError('İade kalem toplamı müşteri iade tutarıyla uyuşmuyor')
    }

    const result = await prisma.$transaction(async (tx) => {
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
            grossProductAmount,
            couponAdjustmentAmount,
            sellerAdjustmentAmount: params.sellerAdjustmentAmount,
            commissionAdjustmentAmount,
            platformFundedAmount,
            status: 'pending',
          },
        })
      } else if (
        !refund.ledgerAppliedAt &&
        !refund.accountingAppliedAt &&
        refund.grossProductAmount.eq(0) &&
        grossProductAmount.gt(0)
      ) {
        // A pre-migration/incomplete queue attempt may have created the refund
        // row before its ledger effect. Enrich that row instead of rejecting a
        // safe idempotent retry.
        refund = await tx.refundTransaction.update({
          where: { id: refund.id },
          data: { grossProductAmount, couponAdjustmentAmount },
        })
      }

      if (
        refund.orderId !== params.orderId ||
        refund.sellerId !== (params.sellerId ?? null) ||
        !refund.customerAmount.equals(params.customerAmount) ||
        !refund.grossProductAmount.equals(grossProductAmount) ||
        !refund.couponAdjustmentAmount.equals(couponAdjustmentAmount) ||
        !refund.sellerAdjustmentAmount.equals(params.sellerAdjustmentAmount) ||
        !refund.commissionAdjustmentAmount.equals(commissionAdjustmentAmount)
      ) {
        throw new ConflictError(
          'Aynı iade anahtarı farklı finansal bilgilerle kullanılamaz',
        )
      }

      const existingItems = await tx.refundTransactionItem.findMany({
        where: { refundTransactionId: refund.id },
      })
      if (existingItems.length === 0) {
        const providerItems = payment
          ? await tx.paymentProviderItem.findMany({ where: { paymentId: payment.id } })
          : []
        const itemSpecs = requestedItems.length > 0
          ? requestedItems
          : [{ kind: 'product' as const, amount: params.customerAmount }]
        for (const spec of itemSpecs) {
          const providerItem = providerItems.find((candidate) =>
            spec.kind === 'shipping'
              ? candidate.kind === 'shipping'
              : candidate.orderLineId === ('orderLineId' in spec ? spec.orderLineId : undefined),
          )
          if (providerItem) {
            const reserved = await tx.refundTransactionItem.aggregate({
              where: {
                paymentProviderItemId: providerItem.id,
                refundTransactionId: { not: refund.id },
              },
              _sum: { amount: true },
            })
            const committed = reserved._sum.amount ?? new Decimal(0)
            if (committed.add(spec.amount).gt(providerItem.amount)) {
              throw new ConflictError('İade kalemi sağlayıcıdaki kalan tutarı aşıyor')
            }
          }
          await tx.refundTransactionItem.create({
            data: {
              refundTransactionId: refund.id,
              ...(providerItem ? { paymentProviderItemId: providerItem.id } : {}),
              ...('orderLineId' in spec && spec.orderLineId
                ? { orderLineId: spec.orderLineId }
                : {}),
              ...('quantity' in spec && spec.quantity
                ? { quantity: spec.quantity }
                : {}),
              kind: spec.kind,
              amount: spec.amount,
              ...(!providerItem || (payment?.method === 'card' && !providerItem.providerTransactionId)
                ? {
                    status: 'manual_required' as const,
                    failureReason:
                      'Sağlayıcı kalem işlem ID’si yok; otomatik iade yerine manuel müdahale gerekli',
                  }
                : {}),
            },
          })
        }
      } else if (requestedItems.length > 0) {
        const actual = existingItems.reduce((sum, item) => sum.add(item.amount), new Decimal(0))
        if (!actual.equals(params.customerAmount)) {
          throw new ConflictError('Aynı iade anahtarı farklı kalem tutarlarıyla kullanılamaz')
        }
      }

      const queuedItems = await tx.refundTransactionItem.findMany({
        where: { refundTransactionId: refund.id },
        select: { status: true },
      })
      if (
        refund.status !== 'completed' &&
        (payment?.method === 'eft' ||
          queuedItems.some((item) => item.status === 'manual_required'))
      ) {
        refund = await tx.refundTransaction.update({
          where: { id: refund.id },
          data: {
            status: 'manual_required',
            failureReason:
              payment?.method === 'eft'
                ? 'EFT/havale iadesi banka üzerinden manuel tamamlanmalıdır'
                : 'Sağlayıcı kalem işlem eşleşmesi eksik; manuel müdahale gerekli',
          },
        })
      }

      const payout = refund.sellerId
        ? await tx.payout.findFirst({
            where: { orderId: refund.orderId, sellerId: refund.sellerId },
          })
        : null

      if (refund.sellerId && refund.grossProductAmount.gt(0) && !refund.ledgerAppliedAt) {
        const appliedAt = new Date()
        const claimed = await tx.refundTransaction.updateMany({
          where: { id: refund.id, ledgerAppliedAt: null },
          data: { ledgerAppliedAt: appliedAt, accountingAppliedAt: appliedAt },
        })
        if (claimed.count === 1) {
          await ledger.createEntry(
            {
              sellerId: refund.sellerId,
              type: 'refund',
              amount: refund.grossProductAmount.negated(),
              eventKey: `refund:product:${refund.id}`,
              effectiveAt: refund.createdAt,
              referenceType: 'refund_transaction',
              referenceId: refund.id,
              description:
                refund.sourceType === 'cancellation'
                  ? `İptal edilen ürün bedeli — ${refund.grossProductAmount.toFixed(2)} TRY`
                  : `İade edilen ürün bedeli — ${refund.grossProductAmount.toFixed(2)} TRY`,
              visibleToSeller: true,
            },
            tx,
          )

          if (refund.couponAdjustmentAmount.gt(0)) {
            await ledger.createEntry(
              {
                sellerId: refund.sellerId,
                type: 'coupon_share',
                amount: refund.couponAdjustmentAmount,
                eventKey: `refund:coupon-reversal:${refund.id}`,
                effectiveAt: refund.createdAt,
                referenceType: 'refund_transaction',
                referenceId: refund.id,
                description: 'İptal/iade edilen ürünlerin satıcı kuponu düzeltmesi',
                visibleToSeller: true,
              },
              tx,
            )
          }

          if (payout && refund.commissionAdjustmentAmount.gt(0)) {
            const originalCommissionEntry = await tx.sellerLedgerEntry.findFirst({
              where: {
                sellerId: refund.sellerId,
                type: 'commission',
                referenceType: 'payout',
                referenceId: payout.id,
              },
            })
            if (originalCommissionEntry) {
              await ledger.createEntry(
                {
                  sellerId: refund.sellerId,
                  type: 'commission',
                  amount: refund.commissionAdjustmentAmount,
                  eventKey: `refund:commission-reversal:${refund.id}`,
                  effectiveAt: refund.createdAt,
                  referenceType: 'refund_transaction',
                  referenceId: refund.id,
                  description: 'İptal/iade edilen ürünlerin komisyon düzeltmesi',
                  visibleToSeller: originalCommissionEntry.visibleToSeller,
                },
                tx,
              )
            }
          }
        }
      }

      if (payout && !refund.payoutAppliedAt) {
        const claimed = await tx.refundTransaction.updateMany({
          where: { id: refund.id, payoutAppliedAt: null },
          data: { payoutAppliedAt: new Date() },
        })
        if (claimed.count === 1 && payout.status !== 'payout_paid') {
          await tx.payout.update({
            where: { id: payout.id },
            data: {
              refundAmount: { increment: refund.grossProductAmount },
              couponShareAmount: Decimal.max(
                new Decimal(0),
                payout.couponShareAmount.sub(refund.couponAdjustmentAmount),
              ),
              commissionAmount: Decimal.max(
                new Decimal(0),
                payout.commissionAmount.sub(refund.commissionAdjustmentAmount),
              ),
              netAmount: Decimal.max(
                new Decimal(0),
                payout.netAmount.sub(refund.sellerAdjustmentAmount),
              ),
            },
          })
        }
      }

      return tx.refundTransaction.findUniqueOrThrow({
        where: { id: refund.id },
        include: { items: true, payment: true },
      })
    })
    if (result.payment?.method === 'card' && result.status !== 'completed') {
      void enqueueRefundProcessing(result.id).catch((error) =>
        console.error('[quantity-refund] Otomatik iade kuyruğa eklenemedi:', error),
      )
    }
    return result
  }

  async function complete(params: {
    refundTransactionId: string
    actorId: string
    providerReference: string
  }) {
    if (!params.providerReference.trim())
      throw new ConflictError('İade işlem referansı gerekli')

    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refundTransaction.findUnique({
        where: { id: params.refundTransactionId },
        include: { items: { include: { paymentProviderItem: true } } },
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
      const unfinishedItems = refund.items.filter((item) => item.status !== 'completed')
      for (const item of unfinishedItems) {
        if (item.paymentProviderItem) {
          const cap = await tx.paymentProviderItem.updateMany({
            where: {
              id: item.paymentProviderItem.id,
              refundedAmount: {
                lte: item.paymentProviderItem.amount.sub(item.amount),
              },
            },
            data: { refundedAmount: { increment: item.amount } },
          })
          if (cap.count !== 1) {
            throw new ConflictError('Manuel iade kalemi kalan tutarı aşıyor')
          }
        }
        await tx.refundTransactionItem.update({
          where: { id: item.id },
          data: {
            status: 'completed',
            providerReference: params.providerReference.trim(),
            failureReason: null,
            completedAt: new Date(),
          },
        })
      }
      const completed = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: refund.id },
      })
      if (refund.paymentId) {
        const increment = unfinishedItems.reduce(
          (sum, item) => sum.add(item.amount),
          new Decimal(0),
        )
        const paymentBefore = await tx.payment.findUniqueOrThrow({
          where: { id: refund.paymentId },
        })
        const paymentCap = await tx.payment.updateMany({
          where: {
            id: refund.paymentId,
            refundedAmount: { lte: paymentBefore.amount.sub(increment) },
          },
          data: { refundedAmount: { increment } },
        })
        if (paymentCap.count !== 1) {
          throw new ConflictError('Manuel iade ödeme kalan tutarını aşıyor')
        }
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: refund.paymentId },
        })
        if (payment.refundedAmount.gte(payment.amount)) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'refunded', refundedAt: new Date() },
          })
        }
      }
      if (refund.sourceType === 'cancellation') {
        const cancellation = await tx.orderCancellation.updateMany({
          where: { id: refund.sourceId },
          data: { status: 'completed' },
        })
        if (cancellation.count === 0 && refund.sourceId.startsWith('legacy-order:')) {
          await tx.order.update({
            where: { id: refund.orderId },
            data: { refundCompletedAt: new Date() },
          })
        }
      } else if (refund.sourceType === 'return_request') {
        await tx.returnRequest.update({
          where: { id: refund.sourceId },
          data: {
            status: 'refund_completed',
            refundedAt: new Date(),
            refundAmount: refund.customerAmount,
          },
        })
        const order = await tx.order.findUniqueOrThrow({
          where: { id: refund.orderId },
          select: { quantityLifecycleVersion: true, status: true },
        })
        if (order.quantityLifecycleVersion !== 2) {
          await tx.order.update({
            where: { id: refund.orderId },
            data: { status: 'refund_completed', refundCompletedAt: new Date() },
          })
          await tx.orderStatusHistory.create({
            data: {
              orderId: refund.orderId,
              fromStatus: order.status,
              toStatus: 'refund_completed',
              actorId: params.actorId,
              reason: 'İade sağlayıcı/banka işlemi manuel olarak tamamlandı',
            },
          })
        }
      } else if (refund.sourceType === 'dispute') {
        await tx.returnRequest.updateMany({
          where: { disputeId: refund.sourceId },
          data: {
            status: 'refund_completed',
            refundedAt: new Date(),
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
    if (result.status === 'completed') {
      void enqueueRefundCompletedNotifications(prisma, result.id).catch((error) =>
        console.error('[quantity-refund] İade bildirimi kuyruğa eklenemedi:', error),
      )
    }
    return result
  }

  return { queue, complete }
}

export type QuantityRefundService = ReturnType<
  typeof createQuantityRefundService
>
