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
import type { Decimal } from '@prisma/client/runtime/client'
import { ConflictError } from '../lib/errors'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { refundPayment as iyzicoRefund } from '../lib/iyzico'

interface RefundServiceDeps {
  prisma: PrismaClient
}

export function createRefundService({ prisma }: RefundServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const ledger = createSellerLedgerRepository(prisma)

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

      const cardPayment = params.payments.find(
        (p) => p.method === 'card' && p.providerPaymentId,
      )
      if (cardPayment?.providerPaymentId) {
        const refundResult = await iyzicoRefund({
          paymentTransactionId: cardPayment.providerPaymentId,
          price: params.refundAmount.toFixed(2),
          conversationId: `refund-${params.returnRequestId}`,
          ip: params.ip ?? '127.0.0.1',
        })
        if (!refundResult.success) {
          throw new ConflictError(
            `Iyzico iade başarısız: ${refundResult.errorMessage ?? refundResult.errorCode ?? 'Bilinmeyen hata'}`,
          )
        }
        await prisma.paymentEvent.create({
          data: {
            paymentId: cardPayment.id,
            eventType: 'refund_initiated',
            payload: {
              note: `İade — ${params.refundAmount.toFixed(2)} TRY (${params.actorRef})`,
              iyzicoRef: refundResult.paymentTransactionId ?? 'N/A',
            },
          },
        })
      }
      // EFT: banka transferi manuel halledilir — provider çağrısı yok.

      await ledger.createEntry({
        sellerId: params.sellerId,
        type: 'refund',
        amount: params.refundAmount.negated(),
        referenceType: 'return_request',
        referenceId: params.returnRequestId,
        orderId: params.orderId,
        description: `İade tamamlandı — ${params.refundAmount.toFixed(2)} TRY`,
        visibleToSeller: true,
      })

      return returnRequests.markRefunded(params.returnRequestId, params.refundAmount)
    },
  }
}

export type RefundService = ReturnType<typeof createRefundService>
