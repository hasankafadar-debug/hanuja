/**
 * Refund Service — single idempotent path for customer refunds tied to a
 * return request. Used by:
 *   - return.service confirmReceiptBySeller (seller confirms receipt)
 *   - return.service markItemReceived (admin override)
 *   - dispute.service resolveDispute (customer-favored resolution)
 *
 * Finance-sensitive (07-marketplace-finance-rules.md):
 *   - idempotent: re-running after ReturnRequest.refundedAt is a no-op
 *   - card → Iyzico; EFT → manual (no provider call)
 *   - always writes a negative seller ledger entry so payout reconciles
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import {
  createQuantityRefundService,
  dispatchRefundProcessingAfterCommit,
} from './quantity-refund.service'
import { allocateLegacyFullRefund, LEGACY_FINANCIAL_REVIEW_PREFIX } from '../domain/legacy-refund-allocation'
import { ConflictError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'
import { assertRoleCan } from '../lib/authorize'

interface RefundServiceDeps {
  prisma: PrismaClient
}

export function createRefundService({ prisma }: RefundServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const quantityRefunds = createQuantityRefundService({ prisma })

  /**
   * Same work as queueLegacyRefund, but on a caller-supplied transaction client
   * so the durable RefundTransaction commits together with the business change
   * (status transition, history, notification outbox) instead of afterwards.
   * Never performs a provider call: quantityRefunds.queue skips provider dispatch
   * when a transaction client is passed, and the caller dispatches after commit.
   */
  async function queueLegacyRefundInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string
      sellerId: string
      sourceType: 'cancellation' | 'return_request' | 'dispute'
      sourceId: string
      requestedCustomerAmount: Decimal
    },
    review?: { actorId: string; reason: string; expectedUpdatedAt: string },
  ) {
    {
      await lockSellerFinance(tx, [params.sellerId])
      await tx.$queryRaw(Prisma.sql`SELECT id FROM orders WHERE id = ${params.orderId} FOR UPDATE`)
      await tx.$queryRaw(Prisma.sql`SELECT id FROM payments WHERE "orderId" = ${params.orderId} ORDER BY id FOR UPDATE`)
      const existing = await tx.refundTransaction.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: params.sourceType,
            sourceId: params.sourceId,
          },
        },
        include: { items: true, payment: true },
      })
      if (existing) {
        if (existing.orderId !== params.orderId || existing.sellerId !== params.sellerId) {
          throw new ConflictError('İade anahtarı başka sipariş veya satıcıya ait')
        }
        if (!review) return existing
        const actor = await tx.user.findUniqueOrThrow({ where: { id: review.actorId }, select: { role: true } })
        assertRoleCan(actor.role, 'finance:adjust_manual')
        if (review.reason.trim().length < 10 || review.reason.length > 1000) throw new ConflictError('İnceleme gerekçesi 10–1000 karakter olmalı')
        if (existing.updatedAt.toISOString() !== review.expectedUpdatedAt || existing.status !== 'manual_required' ||
          !existing.failureReason?.startsWith(LEGACY_FINANCIAL_REVIEW_PREFIX) ||
          existing.accountingAppliedAt || existing.ledgerAppliedAt || existing.payoutAppliedAt || existing.providerReference ||
          existing.items.length > 1 || existing.items.some(i => i.status !== 'manual_required' || i.attemptCount > 0 || i.providerReference || i.paymentProviderItemId)) {
          throw new ConflictError('İade değişmiş veya güvenli yeniden değerlendirmeye uygun değil; sayfayı yenileyin')
        }
      }
      if (review && !existing) throw new ConflictError('İncelenecek iade bulunamadı')

      const order = await tx.order.findUniqueOrThrow({
        where: { id: params.orderId },
        select: {
          quantityLifecycleVersion: true,
          grossAmount: true,
          totalAmount: true,
          refundCompletedAt: true,
          status: true,
          lines: {
            select: {
              sellerId: true,
              quantity: true,
              totalPrice: true,
              couponDiscountAmount: true,
              commissionAmount: true,
              netPayoutAmount: true,
              commissionExemptedAt: true,
            },
          },
          payments: {
            where: { status: 'confirmed' },
            select: { id: true, amount: true, refundedAmount: true },
          },
        },
      })
      if (order.quantityLifecycleVersion === 2) {
        throw new ConflictError('Adet bazlı sipariş eski iade akışıyla işlenemez')
      }

      const otherRefunds = await tx.refundTransaction.aggregate({
        where: { orderId: params.orderId, ...(review && existing ? { id: { not: existing.id } } : {}) },
        _sum: { customerAmount: true },
      })
      // Old flows recorded refunds outside RefundTransaction and did not maintain
      // Payment.refundedAmount. Their amounts cannot safely be added or deduplicated.
      const historicalReturn = await tx.returnRequest.findFirst({
        where: { orderId: params.orderId, OR: [
          { refundedAt: { not: null } }, { status: 'refund_completed' },
        ] }, select: { id: true },
      })
      const historicalPayment = await tx.payment.findFirst({
        where: { orderId: params.orderId, OR: [
          { refundedAt: { not: null } }, { status: 'refunded' },
          { events: { some: { eventType: { startsWith: 'refund' } } } },
        ] }, select: { id: true },
      })
      const returns = await tx.returnRequest.findMany({
        where: { orderId: params.orderId }, select: { id: true },
      })
      const historicalLedger = await tx.sellerLedgerEntry.findFirst({
        where: { type: 'refund', OR: [
          { referenceType: 'order', referenceId: params.orderId },
          { referenceType: 'return_request', referenceId: { in: returns.map((r) => r.id) } },
        ] }, select: { id: true },
      })
      const allocation = allocateLegacyFullRefund({
        sellerId: params.sellerId,
        requestedCustomerAmount: params.requestedCustomerAmount,
        orderGrossAmount: order.grossAmount,
        orderTotalAmount: order.totalAmount,
        lines: order.lines,
        confirmedPayments: order.payments,
        otherRefundAmount: otherRefunds?._sum.customerAmount ?? new Decimal(0),
        hasHistoricalRefundEvidence: Boolean(order.refundCompletedAt ||
          order.status === 'refund_completed' || historicalReturn || historicalPayment || historicalLedger),
      })

      if (review && existing) {
        if (allocation.manualReviewReason) throw new ConflictError(allocation.manualReviewReason)
        if (allocation.customerAmount.gt(existing.customerAmount)) {
          throw new ConflictError('Yeniden değerlendirme kayıtlı müşteri iade tutarını artıramaz')
        }
        const data = {
          customerAmount: allocation.customerAmount, grossProductAmount: allocation.grossProductAmount,
          couponAdjustmentAmount: allocation.couponAdjustmentAmount, sellerAdjustmentAmount: allocation.sellerAdjustmentAmount,
          commissionAdjustmentAmount: allocation.commissionAdjustmentAmount, platformFundedAmount: allocation.platformFundedAmount,
          paymentId: order.payments[0]!.id, failureReason: null,
        }
        await tx.refundTransaction.update({ where: { id: existing.id }, data })
        // Only an unattempted, unmapped legacy placeholder can reach this path.
        if (existing.items.length) await tx.refundTransactionItem.update({ where: { id: existing.items[0]!.id },
          data: { amount: allocation.customerAmount, failureReason: 'Finansal inceleme tamamlandı; manuel ödeme doğrulaması gerekli' } })
        await tx.adminAuditLog.create({ data: {
          actorId: review.actorId, actionType: 'manual_ledger_adjustment', targetType: 'refund_transaction', targetId: existing.id,
          reason: review.reason.trim(), previousData: { customerAmount: existing.customerAmount.toFixed(2), failureReason: existing.failureReason },
          newData: { operation: 'legacy_refund_reassessment', customerAmount: allocation.customerAmount.toFixed(2),
            sellerAdjustmentAmount: allocation.sellerAdjustmentAmount.toFixed(2), paymentId: order.payments[0]!.id },
        } })
      }
      return quantityRefunds.queue({
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        customerAmount: allocation.customerAmount,
        grossProductAmount: allocation.grossProductAmount,
        couponAdjustmentAmount: allocation.couponAdjustmentAmount,
        sellerAdjustmentAmount: allocation.sellerAdjustmentAmount,
        commissionAdjustmentAmount: allocation.commissionAdjustmentAmount,
        platformFundedAmount: allocation.platformFundedAmount,
        ...(allocation.manualReviewReason
          ? { manualReviewReason: allocation.manualReviewReason }
          : {}),
      }, tx)
    }
  }

  async function queueLegacyRefund(params: {
    orderId: string
    sellerId: string
    sourceType: 'cancellation' | 'return_request' | 'dispute'
    sourceId: string
    requestedCustomerAmount: Decimal
  }, review?: { actorId: string; reason: string; expectedUpdatedAt: string }) {
    const refund = await prisma.$transaction(
      (tx) => queueLegacyRefundInTransaction(tx, params, review),
      { timeout: 30_000 },
    )
    await dispatchRefundProcessingAfterCommit(refund)
    return refund
  }

  return {
    async reassessLegacyRefund(params: { refundId: string; actorId: string; reason: string; expectedUpdatedAt: string }) {
      const refund = await prisma.refundTransaction.findUniqueOrThrow({ where: { id: params.refundId } })
      if (!refund.sellerId) throw new ConflictError('Satıcı eşleşmesi eksik')
      // Reuse the amount already recorded; never infer a larger refund from a full order.
      return queueLegacyRefund({ orderId: refund.orderId, sellerId: refund.sellerId,
        sourceType: refund.sourceType, sourceId: refund.sourceId, requestedCustomerAmount: refund.customerAmount }, params)
    },
    /**
     * Execute the refund for a return request on the caller's transaction.
     * Returns the persisted RefundTransaction (or null when the return was
     * already refunded) so the caller can describe the real state to the
     * customer and dispatch the provider job after commit.
     */
    async executeReturnRefundInTransaction(
      tx: Prisma.TransactionClient,
      params: {
        returnRequestId: string
        orderId: string
        sellerId: string
        refundAmount: Decimal
      },
    ) {
      const fresh = await tx.returnRequest.findUnique({
        where: { id: params.returnRequestId },
        select: { refundedAt: true },
      })
      if (fresh?.refundedAt) return null // already refunded — idempotent no-op

      // Resolve customer and seller amounts from immutable checkout snapshots.
      // Incomplete historical data is recorded for review without money movement.
      return queueLegacyRefundInTransaction(tx, {
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: 'return_request',
        sourceId: params.returnRequestId,
        requestedCustomerAmount: params.refundAmount,
      })
    },
    /**
     * Execute the refund for a return request. Idempotent on refundedAt.
     * Returns the (possibly already-refunded) return request.
     */
    async executeReturnRefund(params: {
      returnRequestId: string
      orderId: string
      sellerId: string
      refundAmount: Decimal
      payments: { method: string; id: string; providerPaymentId: string | null }[]
      actorRef: string
      ip?: string
    }) {
      const fresh = await returnRequests.findById(params.returnRequestId)
      if (fresh?.refundedAt) {
        return fresh // already refunded — idempotent no-op
      }

      await queueLegacyRefund({
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: 'return_request',
        sourceId: params.returnRequestId,
        requestedCustomerAmount: params.refundAmount,
      })
      return fresh
    },
    queueLegacyRefund,
    queueLegacyRefundInTransaction,
  }
}

export type RefundService = ReturnType<typeof createRefundService>
