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
import { createQuantityRefundService } from './quantity-refund.service'
import { allocateLegacyFullRefund } from '../domain/legacy-refund-allocation'
import { ConflictError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'

interface RefundServiceDeps {
  prisma: PrismaClient
}

export function createRefundService({ prisma }: RefundServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const quantityRefunds = createQuantityRefundService({ prisma })

  async function queueLegacyRefund(params: {
    orderId: string
    sellerId: string
    sourceType: 'cancellation' | 'return_request' | 'dispute'
    sourceId: string
    requestedCustomerAmount: Decimal
  }) {
    return prisma.$transaction(async (tx) => {
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
        return existing
      }

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
        where: { orderId: params.orderId },
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
    }, { timeout: 30_000 })
  }

  return {
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

      // Resolve customer and seller amounts from immutable checkout snapshots.
      // Incomplete historical data is recorded for review without money movement.
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
  }
}

export type RefundService = ReturnType<typeof createRefundService>
