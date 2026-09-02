import type { PaymentMethod } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export interface RefundProcessorInput {
  refundTransactionId: string
  paymentId: string
  paymentMethod: PaymentMethod
  amount: Decimal
  idempotencyKey: string
}

export interface RefundProcessorResult {
  providerReference: string
}

/**
 * Provider-neutral contract for the payment partner selected before launch.
 * No concrete card processor is wired by this feature.
 */
export interface RefundProcessor {
  refund(input: RefundProcessorInput): Promise<RefundProcessorResult>
}
