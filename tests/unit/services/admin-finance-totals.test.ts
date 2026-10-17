import type { PrismaClient } from '@prisma/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

vi.mock('../../../api/services/fulfillment-risk.service', () => ({
  createFulfillmentRiskService: () => ({ listActiveForAdmin: async () => [] }),
}))

import { createAdminAnalyticsService } from '../../../api/services/admin-analytics.service'

type PaymentRow = {
  status: string
  amount: Decimal
  refundedAmount: Decimal
  confirmedAt: Date | null
}
type AggregateArgs = {
  where?: { status?: string; confirmedAt?: { not: null } | { gte: Date } }
  _sum: Partial<Record<'amount' | 'refundedAmount', true>>
}

// Local-time literals: "today" in the dashboard is the server's local midnight.
const NOW = new Date('2026-10-17T12:00:00')
const START_OF_TODAY = new Date('2026-10-17T00:00:00')
const TODAY = new Date('2026-10-17T08:00:00')
const YESTERDAY = new Date('2026-10-16T09:00:00')

function payment(
  status: string,
  amount: string,
  refundedAmount: string,
  confirmedAt: Date | null,
): PaymentRow {
  return { status, amount: new Decimal(amount), refundedAmount: new Decimal(refundedAmount), confirmedAt }
}

const PAYMENTS = [
  // Partial refund: payment stays confirmed.
  payment('confirmed', '1000.00', '250.00', YESTERDAY),
  // Collected and fully refunded today: payment moved to refunded.
  payment('refunded', '800.00', '800.00', TODAY),
  // No refund.
  payment('confirmed', '500.00', '0.00', YESTERDAY),
  // Never collected.
  payment('cancelled', '300.00', '0.00', null),
  payment('failed', '200.00', '0.00', null),
  payment('pending', '400.00', '0.00', null),
]

function matches(row: PaymentRow, where: AggregateArgs['where'] = {}): boolean {
  if (where.status && row.status !== where.status) return false
  const confirmedAt = where.confirmedAt
  if (!confirmedAt) return true
  if (row.confirmedAt === null) return false
  return !('gte' in confirmedAt) || row.confirmedAt >= confirmedAt.gte
}

// Minimal aggregate double: honours the status/confirmedAt filters and sums whichever
// field is requested, so the previous queries (status filters, `amount` for refunds)
// would produce different totals.
function paymentAggregate(rows: PaymentRow[]) {
  return vi.fn(async ({ where, _sum }: AggregateArgs) => {
    const matched = rows.filter((row) => matches(row, where))
    const sums: Record<string, Decimal | null> = {}
    for (const field of Object.keys(_sum) as Array<keyof typeof _sum>) {
      sums[field] = matched.length
        ? matched.reduce((total, row) => total.add(row[field]), new Decimal(0))
        : null
    }
    return { _sum: sums }
  })
}

function buildPrisma(rows: PaymentRow[]) {
  const aggregate = paymentAggregate(rows)
  return { aggregate, prisma: { payment: { aggregate } } as unknown as PrismaClient }
}

function buildDashboardPrisma(rows: PaymentRow[]) {
  const countModel = () => ({ count: vi.fn(async () => 0) })
  return {
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    $queryRaw: vi.fn(async () => [{ orderCount: 0, lineCount: 0 }]),
    refundTransaction: countModel(),
    order: countModel(),
    returnRequest: countModel(),
    dispute: countModel(),
    payment: { ...countModel(), aggregate: paymentAggregate(rows) },
    payout: { aggregate: vi.fn(async () => ({ _sum: { netAmount: null } })) },
    sellerLedgerEntry: { groupBy: vi.fn(async () => []) },
    penalty: {
      ...countModel(),
      aggregate: vi.fn(async () => ({ _sum: { penaltyAmount: null } })),
    },
    product: countModel(),
    sellerInvoice: countModel(),
    fulfillmentExtensionRequest: countModel(),
    seller: countModel(),
    customerSupportTicket: countModel(),
    supportTicket: countModel(),
  } as unknown as PrismaClient
}

describe('admin finance — gross collected total', () => {
  it('counts every collected payment at its amount, including later refunds', async () => {
    const { prisma, aggregate } = buildPrisma(PAYMENTS)

    const total = await createAdminAnalyticsService({ prisma }).getCollectedPaymentTotal()

    // The old query (status = confirmed) would report 1500 and drop the refunded payment.
    expect(total).toBe(2300)
    expect(aggregate).toHaveBeenCalledWith({
      where: { confirmedAt: { not: null } },
      _sum: { amount: true },
    })
  })

  it('limits to payments collected from the given moment', async () => {
    const { prisma } = buildPrisma(PAYMENTS)

    const total = await createAdminAnalyticsService({ prisma }).getCollectedPaymentTotal({
      confirmedFrom: START_OF_TODAY,
    })

    expect(total).toBe(800)
  })

  it('returns 0 when nothing was collected', async () => {
    const { prisma } = buildPrisma([payment('pending', '400.00', '0.00', null)])
    await expect(
      createAdminAnalyticsService({ prisma }).getCollectedPaymentTotal(),
    ).resolves.toBe(0)
  })
})

describe('admin finance — customer refund total', () => {
  it('sums Payment.refundedAmount across partial, full and non-refunded payments', async () => {
    const { prisma, aggregate } = buildPrisma(PAYMENTS)

    const total = await createAdminAnalyticsService({ prisma }).getCustomerRefundTotal()

    // The old query (status = refunded, sum of amount) would report 800.
    expect(total).toBe(1050)
    expect(aggregate).toHaveBeenCalledWith({ _sum: { refundedAmount: true } })
  })

  it('returns 0 when there are no payments', async () => {
    const { prisma } = buildPrisma([])
    await expect(createAdminAnalyticsService({ prisma }).getCustomerRefundTotal()).resolves.toBe(0)
  })
})

describe('admin dashboard — collected today', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the gross definition: a payment collected and refunded today still counts', async () => {
    const stats = await createAdminAnalyticsService({
      prisma: buildDashboardPrisma(PAYMENTS),
    }).getDashboardStats()

    // The old query (status = confirmed, confirmed today) would report 0.
    expect(stats.payments.collectedToday).toBe(800)
  })
})
