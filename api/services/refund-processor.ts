import type { PaymentProvider } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'
import { refundPayment as iyzicoRefund } from '../lib/iyzico'

export interface RefundProcessorInput {
  refundTransactionId: string
  refundItemId: string
  paymentId: string
  providerPaymentId: string
  providerItemId: string
  paymentTransactionId: string
  amount: Decimal
  currency: string
  idempotencyKey: string
  ip: string
}

export interface RefundProcessorResult {
  providerReference: string
}

export class RefundProviderError extends Error {
  constructor(
    message: string,
    readonly retrySafe: boolean,
  ) {
    super(message)
    this.name = 'RefundProviderError'
  }
}

export interface RefundProcessor {
  refund(input: RefundProcessorInput): Promise<RefundProcessorResult>
}

export function createIyzicoRefundProcessor(): RefundProcessor {
  return {
    async refund(input) {
      let result
      try {
        result = await iyzicoRefund({
          paymentTransactionId: input.paymentTransactionId,
          price: input.amount.toFixed(2),
          currency: input.currency,
          conversationId: input.idempotencyKey,
          ip: input.ip,
        })
      } catch (error) {
        // A transport failure can happen after Iyzico accepted the refund.
        // Reconciliation/manual review must establish whether money moved.
        throw new RefundProviderError(
          `Iyzico iade sonucu belirsiz: ${error instanceof Error ? error.message : 'bağlantı hatası'}`,
          false,
        )
      }
      if (!result.success) {
        throw new RefundProviderError(
          `Iyzico iade başarısız: ${result.errorMessage ?? result.errorCode ?? 'Bilinmeyen hata'}`,
          true,
        )
      }
      return {
        providerReference: result.paymentTransactionId ?? input.paymentTransactionId,
      }
    },
  }
}

export function createRefundProcessor(provider: PaymentProvider): RefundProcessor | null {
  if (provider === 'iyzico') return createIyzicoRefundProcessor()
  return null
}
