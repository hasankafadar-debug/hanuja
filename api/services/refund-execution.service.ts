import type { PrismaClient } from '@prisma/client'
import {
  createRefundProcessor,
  RefundProviderError,
  type RefundProcessor,
} from './refund-processor'
import { enqueueRefundCompletedNotifications } from './refund-notification.service'

type ProcessorFactory = ReturnType<typeof createRefundProcessor> extends infer T
  ? (provider: import('@prisma/client').PaymentProvider) => T
  : never

export function createRefundExecutionService({
  prisma,
  processorFactory = createRefundProcessor,
}: {
  prisma: PrismaClient
  processorFactory?: ProcessorFactory
}) {
  async function refreshParent(refundTransactionId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: refundTransactionId },
        include: { items: true, payment: true },
      })
      const statuses = refund.items.map((item) => item.status)
      const completed = statuses.filter((status) => status === 'completed').length
      const allCompleted = statuses.length > 0 && completed === statuses.length
      const hasManual = statuses.includes('manual_required')
      const hasFailed = statuses.includes('failed')
      const status = allCompleted
        ? 'completed'
        : hasManual
          ? 'manual_required'
          : completed > 0
            ? 'partially_completed'
            : hasFailed
              ? 'failed'
              : 'processing'
      const providerReferences = refund.items
        .map((item) => item.providerReference)
        .filter((value): value is string => Boolean(value))

      const updated = await tx.refundTransaction.update({
        where: { id: refund.id },
        data: {
          status,
          ...(providerReferences.length > 0
            ? { providerReference: providerReferences.join(',') }
            : {}),
          failureReason: hasManual
            ? 'Sağlayıcı kalem eşleşmesi veya sonucu manuel inceleme gerektiriyor'
            : hasFailed
              ? 'Bir veya daha fazla iade kalemi başarısız oldu'
              : null,
          ...(allCompleted ? { completedAt: new Date() } : {}),
        },
      })

      if (allCompleted) {
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
                actorId: 'system',
                reason: 'İade sağlayıcı/banka işlemi tamamlandı',
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
        if (refund.payment) {
          const payment = await tx.payment.findUniqueOrThrow({
            where: { id: refund.payment.id },
          })
          if (payment.refundedAmount.gte(payment.amount)) {
            await tx.payment.update({
              where: { id: payment.id },
              data: { status: 'refunded', refundedAt: new Date() },
            })
          }
        }
      } else if (refund.sourceType === 'cancellation' && (hasFailed || hasManual)) {
        await tx.orderCancellation.updateMany({
          where: { id: refund.sourceId },
          data: { status: 'refund_failed' },
        })
      }
      return { updated, allCompleted }
    })
    if (result.allCompleted) {
      void enqueueRefundCompletedNotifications(prisma, refundTransactionId).catch((error) =>
        console.error('[refund-execution] İade bildirimi kuyruğa eklenemedi:', error),
      )
    }
    return result.updated
  }

  async function markManual(itemId: string, reason: string) {
    await prisma.refundTransactionItem.update({
      where: { id: itemId },
      data: { status: 'manual_required', failureReason: reason },
    })
  }

  async function process(refundTransactionId: string) {
    const refund = await prisma.refundTransaction.findUnique({
      where: { id: refundTransactionId },
      include: {
        payment: true,
        items: {
          include: { paymentProviderItem: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!refund || refund.status === 'completed') return refund
    if (!refund.payment) {
      await Promise.all(
        refund.items
          .filter((item) => item.status !== 'completed')
          .map((item) => markManual(item.id, 'Onaylanmış ödeme kaydı bulunamadı')),
      )
      return refreshParent(refundTransactionId)
    }

    const processor = processorFactory(refund.payment.provider) as RefundProcessor | null
    if (!processor) {
      for (const item of refund.items.filter((entry) => entry.status !== 'completed')) {
        await markManual(item.id, 'EFT/havale iadesi banka üzerinden manuel tamamlanmalıdır')
      }
      return refreshParent(refundTransactionId)
    }

    let retryableFailure: Error | null = null
    for (const item of refund.items) {
      if (item.status === 'completed' || item.status === 'manual_required') continue
      if (item.status === 'processing') {
        await markManual(
          item.id,
          'Önceki sağlayıcı çağrısının sonucu belirsiz; çift iadeyi önlemek için manuel mutabakat gerekli',
        )
        continue
      }
      const providerItem = item.paymentProviderItem
      if (
        !providerItem ||
        !providerItem.providerTransactionId ||
        !refund.payment.providerPaymentId
      ) {
        await markManual(
          item.id,
          'Eski kart ödemesinde Iyzico kalem işlem ID’si yok; üst seviye ödeme ID’si iade için kullanılamaz',
        )
        continue
      }
      if (providerItem.refundedAmount.add(item.amount).gt(providerItem.amount)) {
        await markManual(item.id, 'İade tutarı sağlayıcı kaleminin kalan tutarını aşıyor')
        continue
      }

      const claimed = await prisma.refundTransactionItem.updateMany({
        where: { id: item.id, status: { in: ['pending', 'failed'] } },
        data: {
          status: 'processing',
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          failureReason: null,
        },
      })
      if (claimed.count !== 1) continue

      try {
        const result = await processor.refund({
          refundTransactionId: refund.id,
          refundItemId: item.id,
          paymentId: refund.payment.id,
          providerPaymentId: refund.payment.providerPaymentId,
          providerItemId: providerItem.providerItemId,
          paymentTransactionId: providerItem.providerTransactionId,
          amount: item.amount,
          currency: refund.payment.currency,
          idempotencyKey: `refund-item-${item.id}`,
          ip: globalThis.process.env.REFUND_PROVIDER_IP ?? '127.0.0.1',
        })
        await prisma.$transaction(async (tx) => {
          const cap = await tx.paymentProviderItem.updateMany({
            where: {
              id: providerItem.id,
              refundedAmount: { lte: providerItem.amount.sub(item.amount) },
            },
            data: { refundedAmount: { increment: item.amount } },
          })
          const paymentCap = await tx.payment.updateMany({
            where: {
              id: refund.payment!.id,
              refundedAmount: { lte: refund.payment!.amount.sub(item.amount) },
            },
            data: { refundedAmount: { increment: item.amount } },
          })
          if (cap.count !== 1 || paymentCap.count !== 1) {
            throw new Error('Sağlayıcı iadesi başarılı fakat yerel kalan tutar sınırı değişti')
          }
          await tx.refundTransactionItem.update({
            where: { id: item.id },
            data: {
              status: 'completed',
              providerReference: result.providerReference,
              completedAt: new Date(),
              failureReason: null,
            },
          })
          await tx.paymentEvent.create({
            data: {
              paymentId: refund.payment!.id,
              eventType: 'refund_item_completed',
              payload: {
                refundTransactionId: refund.id,
                refundItemId: item.id,
                providerItemId: providerItem.providerItemId,
                providerReference: result.providerReference,
                amount: item.amount.toFixed(2),
              },
            },
          })
        })
      } catch (error) {
        const retrySafe = error instanceof RefundProviderError && error.retrySafe
        await prisma.refundTransactionItem.update({
          where: { id: item.id },
          data: {
            status: retrySafe ? 'failed' : 'manual_required',
            failureReason: error instanceof Error ? error.message : 'İade başarısız',
          },
        })
        if (retrySafe) retryableFailure = error
      }
    }

    const result = await refreshParent(refundTransactionId)
    if (retryableFailure) throw retryableFailure
    return result
  }

  return { process, refreshParent }
}

export type RefundExecutionService = ReturnType<typeof createRefundExecutionService>
