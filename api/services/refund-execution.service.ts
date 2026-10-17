import { updateReturnRefundState } from './return-refund-state.service'
import type { PrismaClient } from '@prisma/client'
import { syncChangedPayoutSchedules } from './payout-schedule-sync.service'
import {
  createRefundProcessor,
  RefundProviderError,
  type RefundProcessor,
} from './refund-processor'
import { enqueueCustomerRefundCompletedNotification } from './refund-notification.service'
import { LEGACY_FINANCIAL_REVIEW_PREFIX } from '../domain/legacy-refund-allocation'
import { getPaymentReport as fetchPaymentReport } from '../lib/iyzico'

/**
 * Yalnız sağlayıcı sonucu belirsiz kalan kalemler raporla sonuçlandırılır; tavan aşımı gibi
 * başka nedenlerle manuele düşen kalemler yöneticide kalır.
 */
function isUncertainOutcome(reason: string | null) {
  return !!reason && (reason.includes('sonucu belirsiz') || reason.includes('imza doğrulanamadı'))
}

/** Belirsiz kart iadesi, raporda iz yoksa bu süreden sonra yeniden denenir (körlemesine değil). */
const CARD_REFUND_RETRY_AFTER_MS = 60 * 60_000
/** Bu süreden uzun 'processing' kalan kalem (süreç kapandı) belirsiz sayılır. */
const CARD_REFUND_STALE_PROCESSING_MS = 15 * 60_000

type ProcessorFactory =
  ReturnType<typeof createRefundProcessor> extends infer T
    ? (provider: import('@prisma/client').PaymentProvider) => T
    : never

export function createRefundExecutionService({
  prisma,
  processorFactory = createRefundProcessor,
  getPaymentReport = fetchPaymentReport,
  now = () => new Date(),
}: {
  prisma: PrismaClient
  processorFactory?: ProcessorFactory
  getPaymentReport?: typeof fetchPaymentReport
  now?: () => Date
}) {
  async function refreshParent(refundTransactionId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const refund = await tx.refundTransaction.findUniqueOrThrow({
        where: { id: refundTransactionId },
        include: { items: true, payment: true },
      })
      if (refund.failureReason?.startsWith(LEGACY_FINANCIAL_REVIEW_PREFIX)) {
        return { updated: refund, allCompleted: false }
      }
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
          await updateReturnRefundState(tx, refund)

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
          await updateReturnRefundState(tx, refund)
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
      await syncChangedPayoutSchedules(prisma, {
        orderId: result.updated.orderId,
        sellerId: result.updated.sellerId,
      })
      void enqueueCustomerRefundCompletedNotification(prisma, refundTransactionId).catch((error) =>
        console.error('[refund-execution] İade bildirimi kuyruğa eklenemedi:', error),
      )
    }
    return result.updated
  }

  /** Sağlayıcıda gerçekleştiği kanıtlanan kalem iadesini yerel tavanlarla birlikte kapatır. */
  async function finalizeItemRefund(params: {
    itemId: string
    amount: import('@prisma/client/runtime/client').Decimal
    refundTransactionId: string
    providerItem: { id: string; amount: import('@prisma/client/runtime/client').Decimal; providerItemId: string }
    payment: { id: string; amount: import('@prisma/client/runtime/client').Decimal }
    providerReference: string
    eventType?: string
  }) {
    await prisma.$transaction(async (tx) => {
      const cap = await tx.paymentProviderItem.updateMany({
        where: {
          id: params.providerItem.id,
          refundedAmount: { lte: params.providerItem.amount.sub(params.amount) },
        },
        data: { refundedAmount: { increment: params.amount } },
      })
      const paymentCap = await tx.payment.updateMany({
        where: {
          id: params.payment.id,
          refundedAmount: { lte: params.payment.amount.sub(params.amount) },
        },
        data: { refundedAmount: { increment: params.amount } },
      })
      if (cap.count !== 1 || paymentCap.count !== 1) {
        throw new Error('Sağlayıcı iadesi başarılı fakat yerel kalan tutar sınırı değişti')
      }
      await tx.refundTransactionItem.update({
        where: { id: params.itemId },
        data: {
          status: 'completed',
          providerReference: params.providerReference,
          completedAt: new Date(),
          failureReason: null,
        },
      })
      await tx.paymentEvent.create({
        data: {
          paymentId: params.payment.id,
          eventType: params.eventType ?? 'refund_item_completed',
          payload: {
            refundTransactionId: params.refundTransactionId,
            refundItemId: params.itemId,
            providerItemId: params.providerItem.providerItemId,
            providerReference: params.providerReference,
            amount: params.amount.toFixed(2),
          },
        },
      })
    })
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
    if (refund.failureReason?.startsWith(LEGACY_FINANCIAL_REVIEW_PREFIX)) return refund
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
        await finalizeItemRefund({
          itemId: item.id,
          amount: item.amount,
          refundTransactionId: refund.id,
          providerItem,
          payment: refund.payment,
          providerReference: result.providerReference,
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

  /** iyzico raporunda ödemeyi bulmak için ödeme denemesinin conversationId'si (eski ödemelerde sipariş id). */
  async function paymentConversationId(payment: { providerPaymentId: string | null }, orderId: string) {
    if (!payment.providerPaymentId) return orderId
    const attempt = await prisma.cardPaymentAttempt.findUnique({
      where: { providerPaymentId: payment.providerPaymentId },
      select: { conversationId: true },
    })
    return attempt?.conversationId ?? orderId
  }

  /**
   * Sonucu belirsiz kart iadesini iyzico raporuyla sonuçlandırır. İade isteğinde kullanılan
   * conversationId (`refund-item-<id>`) raporda refundConversationId olarak aranır.
   * Raporda iz yoksa ve son denemenin üzerinden yeterli süre geçtiyse kalem yeniden denemeye açılır.
   */
  async function reconcileCardRefund(refundTransactionId: string) {
    const refund = await prisma.refundTransaction.findUnique({
      where: { id: refundTransactionId },
      include: {
        payment: true,
        items: { include: { paymentProviderItem: true }, orderBy: { createdAt: 'asc' } },
      },
    })
    const summary = { completed: 0, reopened: 0, unresolved: 0, reportUnavailable: false }
    if (!refund?.payment || refund.payment.method !== 'card' || !refund.payment.providerPaymentId) {
      return summary
    }
    const candidates = refund.items.filter(
      (item) =>
        item.paymentProviderItem?.providerTransactionId &&
        ((item.status === 'manual_required' && isUncertainOutcome(item.failureReason)) ||
          (item.status === 'processing' &&
            (!item.lastAttemptAt ||
              now().getTime() - item.lastAttemptAt.getTime() >= CARD_REFUND_STALE_PROCESSING_MS))),
    )
    if (candidates.length === 0) return summary

    const report = await getPaymentReport({
      paymentConversationId: await paymentConversationId(refund.payment, refund.orderId),
      conversationId: `rec-refund-${refund.id}`,
    })
    if (report.kind !== 'success') {
      summary.reportUnavailable = true
      return summary
    }
    const paymentReport = report.data.find((entry) => entry.paymentId === refund.payment!.providerPaymentId)
    if (!paymentReport) {
      summary.reportUnavailable = true
      return summary
    }

    for (const item of candidates) {
      const providerItem = item.paymentProviderItem!
      const match = paymentReport.refunds.find(
        (entry) =>
          entry.scope === 'refund' &&
          entry.conversationId === `refund-item-${item.id}` &&
          entry.paymentTransactionId === providerItem.providerTransactionId,
      )
      if (match) {
        await finalizeItemRefund({
          itemId: item.id,
          amount: item.amount,
          refundTransactionId: refund.id,
          providerItem,
          payment: refund.payment,
          providerReference: match.providerReference ?? providerItem.providerTransactionId!,
          eventType: 'refund_item_reconciled',
        })
        summary.completed += 1
        continue
      }
      const lastAttemptAt = item.lastAttemptAt ?? item.updatedAt
      if (now().getTime() - lastAttemptAt.getTime() >= CARD_REFUND_RETRY_AFTER_MS) {
        await prisma.refundTransactionItem.updateMany({
          where: { id: item.id, status: { in: ['manual_required', 'processing'] } },
          data: {
            status: 'failed',
            failureReason: 'iyzico raporunda iade izi yok; yeniden denenecek',
          },
        })
        summary.reopened += 1
      } else {
        summary.unresolved += 1
      }
    }
    await refreshParent(refund.id)
    return summary
  }

  /**
   * Worker taraması: kuyruğa hiç alınamamış veya tekrar denenebilir kart iadelerini işler,
   * belirsiz/uzun süre "processing" kalanları raporla sonuçlandırır.
   */
  async function sweepCardRefunds(limit = 25) {
    const staleBefore = new Date(now().getTime() - CARD_REFUND_STALE_PROCESSING_MS)
    const refunds = await prisma.refundTransaction.findMany({
      where: {
        status: { notIn: ['completed', 'voided'] },
        payment: { method: 'card' },
        items: {
          some: {
            OR: [
              { status: 'pending', createdAt: { lte: staleBefore } },
              { status: 'failed', lastAttemptAt: { lte: staleBefore } },
              { status: 'processing', lastAttemptAt: { lte: staleBefore } },
              {
                status: 'manual_required',
                failureReason: { contains: 'belirsiz' },
                paymentProviderItem: { providerTransactionId: { not: null } },
              },
            ],
          },
        },
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    })
    const summary = { processed: 0, reconciled: 0 }
    for (const refund of refunds) {
      try {
        const reconciliation = await reconcileCardRefund(refund.id)
        summary.reconciled += reconciliation.completed + reconciliation.reopened
        await process(refund.id)
        summary.processed += 1
      } catch (error) {
        console.error('[refund-sweep] kart iadesi işlenemedi', {
          refundTransactionId: refund.id,
          message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        })
      }
    }
    return summary
  }

  return { process, refreshParent, reconcileCardRefund, sweepCardRefunds }
}

export type RefundExecutionService = ReturnType<typeof createRefundExecutionService>
