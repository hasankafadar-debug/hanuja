import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { enqueueRefundCompletedNotifications } = vi.hoisted(() => ({
  enqueueRefundCompletedNotifications: vi.fn(async () => undefined),
}))

vi.mock('../../../api/services/refund-notification.service', () => ({
  enqueueRefundCompletedNotifications,
}))

import { createRefundExecutionService } from '../../../api/services/refund-execution.service'
import { RefundProviderError, type RefundProcessor } from '../../../api/services/refund-processor'

type ProviderItem = {
  id: string
  providerItemId: string
  providerTransactionId: string | null
  amount: InstanceType<typeof Decimal>
  refundedAmount: InstanceType<typeof Decimal>
}

type RefundItem = {
  id: string
  status: string
  amount: InstanceType<typeof Decimal>
  paymentProviderItem: ProviderItem | null
  providerReference: string | null
  failureReason: string | null
  attemptCount: number
  completedAt: Date | null
}

function buildExecutionPrisma(amounts: string[], options?: { missingProviderTransaction?: boolean }) {
  const payment = {
    id: 'payment-1',
    provider: 'iyzico',
    providerPaymentId: 'top-level-payment-id',
    currency: 'TRY',
    amount: amounts.reduce((sum, amount) => sum.add(amount), new Decimal(0)),
    refundedAmount: new Decimal(0),
    status: 'confirmed',
  }
  const providerItems: ProviderItem[] = amounts.map((amount, index) => ({
    id: `provider-item-${index + 1}`,
    providerItemId: `line:line-${index + 1}`,
    providerTransactionId: options?.missingProviderTransaction
      ? null
      : `iyzico-item-tx-${index + 1}`,
    amount: new Decimal(amount),
    refundedAmount: new Decimal(0),
  }))
  const items: RefundItem[] = amounts.map((amount, index) => ({
    id: `refund-item-${index + 1}`,
    status: 'pending',
    amount: new Decimal(amount),
    paymentProviderItem: providerItems[index]!,
    providerReference: null,
    failureReason: null,
    attemptCount: 0,
    completedAt: null,
  }))
  const refund: Record<string, any> = {
    id: 'refund-1',
    orderId: 'order-1',
    paymentId: payment.id,
    sourceType: 'cancellation',
    sourceId: 'cancellation-1',
    customerAmount: payment.amount,
    status: 'pending',
    providerReference: null,
    failureReason: null,
    completedAt: null,
  }

  const prisma: Record<string, any> = {
    refundTransaction: {
      findUnique: vi.fn(async () => ({ ...refund, payment, items })),
      findUniqueOrThrow: vi.fn(async () => ({ ...refund, payment, items })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(refund, data)
        return { ...refund }
      }),
    },
    refundTransactionItem: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const item = items.find((candidate) => candidate.id === where.id)
        if (!item || !where.status.in.includes(item.status)) return { count: 0 }
        item.status = data.status
        item.attemptCount += data.attemptCount?.increment ?? 0
        item.failureReason = data.failureReason ?? null
        return { count: 1 }
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const item = items.find((candidate) => candidate.id === where.id)!
        Object.assign(item, data)
        return item
      }),
    },
    paymentProviderItem: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const providerItem = providerItems.find((candidate) => candidate.id === where.id)!
        const maximum = where.refundedAmount.lte as InstanceType<typeof Decimal>
        if (providerItem.refundedAmount.gt(maximum)) return { count: 0 }
        providerItem.refundedAmount = providerItem.refundedAmount.add(data.refundedAmount.increment)
        return { count: 1 }
      }),
    },
    payment: {
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, any> }) => {
        const maximum = where.refundedAmount.lte as InstanceType<typeof Decimal>
        if (payment.refundedAmount.gt(maximum)) return { count: 0 }
        payment.refundedAmount = payment.refundedAmount.add(data.refundedAmount.increment)
        return { count: 1 }
      }),
      findUniqueOrThrow: vi.fn(async () => payment),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(payment, data)
        return payment
      }),
    },
    paymentEvent: { create: vi.fn(async () => ({})) },
    orderCancellation: { updateMany: vi.fn(async () => ({ count: 1 })) },
    order: { update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn() },
    returnRequest: { update: vi.fn(), updateMany: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
  }
  prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma),
  )

  return {
    prisma: prisma as import('@prisma/client').PrismaClient,
    payment,
    providerItems,
    items,
    refund,
  }
}

describe('refund execution service', () => {
  beforeEach(() => enqueueRefundCompletedNotifications.mockClear())

  it('keeps completed items idempotent while retrying only a safe failed item', async () => {
    const state = buildExecutionPrisma(['40.00', '60.00'])
    const refund = vi.fn<Parameters<RefundProcessor['refund']>, ReturnType<RefundProcessor['refund']>>()
      .mockResolvedValueOnce({ providerReference: 'provider-ref-1' })
      .mockRejectedValueOnce(new RefundProviderError('provider rejected', true))
      .mockResolvedValueOnce({ providerReference: 'provider-ref-2' })
    const service = createRefundExecutionService({
      prisma: state.prisma,
      processorFactory: () => ({ refund }),
    })

    await expect(service.process('refund-1')).rejects.toMatchObject({ retrySafe: true })
    expect(state.refund.status).toBe('partially_completed')
    expect(state.items[0]).toMatchObject({
      status: 'completed',
      providerReference: 'provider-ref-1',
      attemptCount: 1,
    })
    expect(state.items[1]).toMatchObject({ status: 'failed', attemptCount: 1 })

    await expect(service.process('refund-1')).resolves.toMatchObject({ status: 'completed' })
    expect(refund).toHaveBeenCalledTimes(3)
    expect(refund.mock.calls.map(([input]) => input.refundItemId)).toEqual([
      'refund-item-1',
      'refund-item-2',
      'refund-item-2',
    ])
    expect(state.payment.refundedAmount.toFixed(2)).toBe('100.00')
    expect(state.payment.status).toBe('refunded')
    expect(state.refund.providerReference).toBe('provider-ref-1,provider-ref-2')
  })

  it('requires manual reconciliation when the basket-item transaction id is missing', async () => {
    const state = buildExecutionPrisma(['25.00'], { missingProviderTransaction: true })
    const refund = vi.fn(async () => ({ providerReference: 'must-not-run' }))
    const service = createRefundExecutionService({
      prisma: state.prisma,
      processorFactory: () => ({ refund }),
    })

    await expect(service.process('refund-1')).resolves.toMatchObject({
      status: 'manual_required',
    })
    expect(refund).not.toHaveBeenCalled()
    expect(state.items[0]?.failureReason).toContain('üst seviye ödeme ID’si iade için kullanılamaz')
    expect(state.payment.refundedAmount.toFixed(2)).toBe('0.00')
  })
})
