import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { refundPayment } = vi.hoisted(() => ({ refundPayment: vi.fn() }))

vi.mock('../../../api/lib/iyzico', () => ({ refundPayment }))

import {
  createIyzicoRefundProcessor,
  createRefundProcessor,
  RefundProviderError,
} from '../../../api/services/refund-processor'

const input = {
  refundTransactionId: 'refund-1',
  refundItemId: 'refund-item-1',
  paymentId: 'payment-db-1',
  providerPaymentId: 'iyzico-payment-top-level',
  providerItemId: 'line:line-1',
  paymentTransactionId: 'iyzico-basket-transaction-1',
  amount: new Decimal('25.50'),
  currency: 'TRY',
  idempotencyKey: 'refund-item-refund-item-1',
  ip: '127.0.0.1',
}

describe('Iyzico refund processor', () => {
  beforeEach(() => refundPayment.mockReset())

  it('refunds the basket-item transaction and never the top-level payment id', async () => {
    refundPayment.mockResolvedValue({
      success: true,
      paymentTransactionId: 'provider-refund-1',
    })

    await expect(createIyzicoRefundProcessor().refund(input)).resolves.toEqual({
      providerReference: 'provider-refund-1',
    })
    expect(refundPayment).toHaveBeenCalledWith({
      paymentTransactionId: 'iyzico-basket-transaction-1',
      price: '25.50',
      currency: 'TRY',
      conversationId: 'refund-item-refund-item-1',
      ip: '127.0.0.1',
    })
  })

  it('marks an explicit provider rejection as safe to retry', async () => {
    refundPayment.mockResolvedValue({ success: false, errorCode: '12' })
    await expect(createIyzicoRefundProcessor().refund(input)).rejects.toMatchObject({
      retrySafe: true,
    } satisfies Partial<RefundProviderError>)
  })

  it('represents transport ambiguity as unsafe to retry', () => {
    const error = new RefundProviderError('Iyzico iade sonucu belirsiz', false)
    expect(error.retrySafe).toBe(false)
  })

  it('keeps EFT as a manual provider flow', () => {
    expect(createRefundProcessor('manual_eft')).toBeNull()
  })
})
