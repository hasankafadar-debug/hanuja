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

interface RefundServiceDeps {
  prisma: PrismaClient
}

export function createRefundService({ prisma }: RefundServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const quantityRefunds = createQuantityRefundService({ prisma })

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

      // Legacy returns do not have a trustworthy order-line/provider-item
      // allocation. Queue a manually resolvable refund and never substitute the
      // top-level Iyzico payment id for a basket-item transaction id.
      await quantityRefunds.queue({
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: 'return_request',
        sourceId: params.returnRequestId,
        customerAmount: params.refundAmount,
        grossProductAmount: params.refundAmount,
        sellerAdjustmentAmount: params.refundAmount,
        platformFundedAmount: new Decimal(0),
      })
      return fresh
    },
  }
}

export type RefundService = ReturnType<typeof createRefundService>
