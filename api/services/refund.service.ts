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
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createQuantityRefundService } from './quantity-refund.service'
import { allocateLegacyFullRefund } from '../domain/legacy-refund-allocation'
import { ConflictError } from '../lib/errors'

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
    const existing = await prisma.refundTransaction.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
      },
      include: { items: true, payment: true },
    })
    if (existing) return existing

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: params.orderId },
      select: {
        quantityLifecycleVersion: true,
        grossAmount: true,
        totalAmount: true,
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

    const paymentIds = order.payments.map((payment) => payment.id)
    const otherRefunds = paymentIds.length
      ? await prisma.refundTransaction.aggregate({
          where: { paymentId: { in: paymentIds } },
          _sum: { customerAmount: true },
        })
      : null
    const allocation = allocateLegacyFullRefund({
      sellerId: params.sellerId,
      requestedCustomerAmount: params.requestedCustomerAmount,
      orderGrossAmount: order.grossAmount,
      orderTotalAmount: order.totalAmount,
      lines: order.lines,
      confirmedPayments: order.payments,
      otherRefundAmount: otherRefunds?._sum.customerAmount ?? new Decimal(0),
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
    })
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
