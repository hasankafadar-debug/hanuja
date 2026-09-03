import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

const { enqueueRefundProcessing, enqueueRefundCompletedNotifications } = vi.hoisted(() => ({
  enqueueRefundProcessing: vi.fn(async () => undefined),
  enqueueRefundCompletedNotifications: vi.fn(async () => undefined),
}))

vi.mock('../../../api/jobs/refund-processing.job', () => ({ enqueueRefundProcessing }))
vi.mock('../../../api/services/refund-notification.service', () => ({
  enqueueRefundCompletedNotifications,
}))

import { createQuantityRefundService } from '../../../api/services/quantity-refund.service'

type LedgerRow = {
  id: string
  sellerId: string
  type: string
  amount: InstanceType<typeof Decimal>
  eventKey?: string
  referenceType?: string
  referenceId?: string
  visibleToSeller?: boolean
}

function buildQueuePrisma(payoutStatus?: 'payout_ready' | 'payout_paid') {
  const payment = {
    id: 'payment-1',
    orderId: 'order-1',
    method: 'card',
    provider: 'iyzico',
    status: 'confirmed',
    currency: 'TRY',
  }
  const providerItem = {
    id: 'provider-item-1',
    paymentId: payment.id,
    orderLineId: 'line-1',
    kind: 'product',
    amount: new Decimal('100.00'),
    refundedAmount: new Decimal(0),
    providerTransactionId: 'iyzico-item-tx-1',
  }
  const payout = payoutStatus
    ? {
        id: 'payout-1',
        orderId: 'order-1',
        sellerId: 'seller-1',
        status: payoutStatus,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        couponShareAmount: new Decimal('10.00'),
        commissionAmount: new Decimal('18.00'),
        netAmount: new Decimal('72.00'),
      }
    : null
  let refund: Record<string, any> | null = null
  const items: Array<Record<string, any>> = []
  const ledgerEntries: LedgerRow[] = []
  if (payoutStatus === 'payout_paid') {
    ledgerEntries.push({
      id: 'original-commission',
      sellerId: 'seller-1',
      type: 'commission',
      amount: new Decimal('-18.00'),
      eventKey: 'payout:commission:payout-1',
      referenceType: 'payout',
      referenceId: 'payout-1',
      visibleToSeller: true,
    })
  }
  const payoutUpdate = vi.fn(async () => payout)

  const prisma: Record<string, any> = {
    payment: { findFirst: vi.fn(async () => payment) },
    refundTransaction: {
      findUnique: vi.fn(async () => refund),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        refund = {
          id: 'refund-1',
          sellerId: null,
          paymentId: null,
          ledgerAppliedAt: null,
          accountingAppliedAt: null,
          payoutAppliedAt: null,
          completedAt: null,
          createdAt: new Date('2026-09-03T08:00:00.000Z'),
          ...data,
        }
        return refund
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(refund!, data)
        return refund
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, any>; data: Record<string, unknown> }) => {
        if ('ledgerAppliedAt' in where && refund?.ledgerAppliedAt !== null) return { count: 0 }
        if ('payoutAppliedAt' in where && refund?.payoutAppliedAt !== null) return { count: 0 }
        Object.assign(refund!, data)
        return { count: 1 }
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...refund!, items: [...items], payment })),
    },
    refundTransactionItem: {
      findMany: vi.fn(async ({ select }: { select?: Record<string, unknown> }) =>
        select ? items.map((item) => ({ status: item.status })) : [...items],
      ),
      aggregate: vi.fn(async () => ({ _sum: { amount: new Decimal(0) } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const item = { id: `refund-item-${items.length + 1}`, status: 'pending', ...data }
        items.push(item)
        return item
      }),
    },
    paymentProviderItem: { findMany: vi.fn(async () => [providerItem]) },
    payout: { findFirst: vi.fn(async () => payout), update: payoutUpdate },
    sellerLedgerEntry: {
      findUnique: vi.fn(async ({ where }: { where: { eventKey: string } }) =>
        ledgerEntries.find((entry) => entry.eventKey === where.eventKey) ?? null,
      ),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        ledgerEntries.find((entry) =>
          entry.sellerId === where.sellerId &&
          entry.type === where.type &&
          entry.referenceType === where.referenceType &&
          entry.referenceId === where.referenceId,
        ) ?? null,
      ),
      aggregate: vi.fn(async ({ where }: { where: { sellerId: string } }) => ({
        _sum: {
          amount: ledgerEntries
            .filter((entry) => entry.sellerId === where.sellerId)
            .reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)),
        },
      })),
      create: vi.fn(async ({ data }: { data: Omit<LedgerRow, 'id'> }) => {
        const entry = { id: `ledger-${ledgerEntries.length + 1}`, ...data }
        ledgerEntries.push(entry)
        return entry
      }),
    },
  }
  prisma.$transaction = vi.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) =>
    callback(prisma),
  )

  return {
    prisma: prisma as import('@prisma/client').PrismaClient,
    ledgerEntries,
    payoutUpdate,
  }
}

function queueCancellation(prisma: import('@prisma/client').PrismaClient, amounts: {
  customer: string
  gross: string
  coupon: string
  seller: string
  commission: string
  quantity: number
}) {
  return createQuantityRefundService({ prisma }).queue({
    orderId: 'order-1',
    sellerId: 'seller-1',
    sourceType: 'cancellation',
    sourceId: 'cancellation-1',
    customerAmount: new Decimal(amounts.customer),
    grossProductAmount: new Decimal(amounts.gross),
    couponAdjustmentAmount: new Decimal(amounts.coupon),
    sellerAdjustmentAmount: new Decimal(amounts.seller),
    commissionAdjustmentAmount: new Decimal(amounts.commission),
    platformFundedAmount: new Decimal(0),
    items: [{
      orderLineId: 'line-1',
      quantity: amounts.quantity,
      amount: new Decimal(amounts.customer),
    }],
  })
}

describe('quantity refund accounting', () => {
  beforeEach(() => {
    enqueueRefundProcessing.mockClear()
    enqueueRefundCompletedNotifications.mockClear()
  })

  it('posts gross reversal and seller-coupon correction once for a partial cancellation', async () => {
    const { prisma, ledgerEntries } = buildQueuePrisma()

    await queueCancellation(prisma, {
      customer: '45.00',
      gross: '50.00',
      coupon: '5.00',
      seller: '36.00',
      commission: '9.00',
      quantity: 1,
    })
    await queueCancellation(prisma, {
      customer: '45.00',
      gross: '50.00',
      coupon: '5.00',
      seller: '36.00',
      commission: '9.00',
      quantity: 1,
    })

    const refundEntries = ledgerEntries.filter((entry) => entry.referenceType === 'refund_transaction')
    expect(refundEntries).toHaveLength(2)
    expect(refundEntries.find((entry) => entry.type === 'refund')?.amount.toFixed(2)).toBe('-50.00')
    expect(refundEntries.find((entry) => entry.type === 'coupon_share')?.amount.toFixed(2)).toBe('5.00')
    expect(refundEntries.reduce((sum, entry) => sum.add(entry.amount), new Decimal(0)).toFixed(2)).toBe('-45.00')
  })

  it('reduces an unpaid payout without creating a negative payout amount', async () => {
    const { prisma, payoutUpdate } = buildQueuePrisma('payout_ready')

    await queueCancellation(prisma, {
      customer: '90.00',
      gross: '100.00',
      coupon: '10.00',
      seller: '72.00',
      commission: '18.00',
      quantity: 2,
    })

    expect(payoutUpdate).toHaveBeenCalledWith({
      where: { id: 'payout-1' },
      data: expect.objectContaining({
        couponShareAmount: expect.objectContaining({}),
        commissionAmount: expect.objectContaining({}),
        netAmount: expect.objectContaining({}),
      }),
    })
    const data = payoutUpdate.mock.calls[0]![0].data
    expect(data.couponShareAmount.toFixed(2)).toBe('0.00')
    expect(data.commissionAmount.toFixed(2)).toBe('0.00')
    expect(data.netAmount.toFixed(2)).toBe('0.00')
  })

  it('leaves a paid payout immutable and posts the commission reversal to the ledger', async () => {
    const { prisma, ledgerEntries, payoutUpdate } = buildQueuePrisma('payout_paid')

    await queueCancellation(prisma, {
      customer: '90.00',
      gross: '100.00',
      coupon: '10.00',
      seller: '72.00',
      commission: '18.00',
      quantity: 2,
    })

    expect(payoutUpdate).not.toHaveBeenCalled()
    expect(ledgerEntries.find((entry) => entry.eventKey === 'refund:product:refund-1')?.amount.toFixed(2)).toBe('-100.00')
    expect(ledgerEntries.find((entry) => entry.eventKey === 'refund:coupon-reversal:refund-1')?.amount.toFixed(2)).toBe('10.00')
    expect(ledgerEntries.find((entry) => entry.eventKey === 'refund:commission-reversal:refund-1')?.amount.toFixed(2)).toBe('18.00')
  })
})
