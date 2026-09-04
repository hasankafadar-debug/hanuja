import type { PrismaClient, RefundTransactionStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { createAdminRefundQueryService } from '../../../api/services/admin-refund-query.service'

vi.mock('../../../api/services/fulfillment-risk.service', () => ({
  createFulfillmentRiskService: () => ({ listActiveForAdmin: async () => [] }),
}))

import { createAdminAnalyticsService } from '../../../api/services/admin-analytics.service'

function refund(
  id: string,
  status: RefundTransactionStatus = 'manual_required',
  method: 'eft' | 'card' | null = 'eft',
) {
  return {
    id,
    orderId: 'same-order',
    sourceType: 'cancellation',
    sourceId: `source-${id}`,
    status,
    customerAmount: new Decimal('38560.50'),
    failureReason: 'İade bekliyor',
    createdAt: new Date('2026-09-03T10:00:00Z'),
    order: {
      publicNumber: 26050074,
      currency: 'TRY',
      customer: { id: 'customer-1', name: 'Müşteri' },
    },
    payment: method ? { method, provider: method === 'eft' ? 'manual_eft' : 'iyzico' } : null,
    items: [
      {
        id: `item-${id}`,
        amount: new Decimal('38560.50'),
        status:
          status === 'completed'
            ? 'completed'
            : status === 'manual_required'
              ? 'pending'
              : 'failed',
        attemptCount: 0,
        lastAttemptAt: null as Date | null,
        failureReason: null as string | null,
      },
    ],
  }
}

type Row = ReturnType<typeof refund>
type Filter = {
  id?: string
  orderId?: string
  sourceType?: string
  status?: string
  payment?: { is: { method: string } | null }
  order?: {
    is: { publicNumber?: number; customer?: { is: { name: { contains: string; mode: string } } } }
  }
  items?: { some: { status: string } }
  OR?: Filter[]
  AND?: Filter[]
}

// Minimal relational-filter double; assertions below also pin the actual query
// contract so an accidentally broadened filter cannot pass via fixture choices.
function matches(row: Row, where: Filter): boolean {
  return (
    (!where.id || row.id === where.id) &&
    (!where.orderId || row.orderId === where.orderId) &&
    (!where.sourceType || row.sourceType === where.sourceType) &&
    (!where.status || row.status === where.status) &&
    (!where.payment ||
      (where.payment.is === null
        ? row.payment === null
        : row.payment?.method === where.payment.is.method)) &&
    (!where.order?.is.publicNumber || row.order.publicNumber === where.order.is.publicNumber) &&
    (!where.order?.is.customer ||
      row.order.customer.name
        .toLocaleLowerCase('tr-TR')
        .includes(where.order.is.customer.is.name.contains.toLocaleLowerCase('tr-TR'))) &&
    (!where.items || row.items.some((item) => item.status === where.items!.some.status)) &&
    (!where.OR || where.OR.some((condition) => matches(row, condition))) &&
    (!where.AND || where.AND.every((condition) => matches(row, condition)))
  )
}

function buildPrisma(rows: Row[] = []) {
  const db = {
    refundTransaction: {
      findMany: vi.fn(
        async ({ where, skip, take }: { where: Filter; skip: number; take: number }) =>
          rows
            .filter((row) => matches(row, where))
            .sort(
              (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
            )
            .slice(skip, skip + take),
      ),
      count: vi.fn(
        async ({ where }: { where: Filter }) => rows.filter((row) => matches(row, where)).length,
      ),
    },
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
  }
  return { db, prisma: db as unknown as PrismaClient }
}

describe('admin refund query service', () => {
  it.each(['26050074', '#26050074', 'müşteri', 'same-order', 'manual'])(
    'searches the full manual queue without reintroducing completed refunds: %s',
    async (query) => {
      const { prisma, db } = buildPrisma([refund('manual'), refund('completed', 'completed')])
      const result = await createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin({
        query,
      })
      expect(result.rows.map((row) => row.id)).toEqual(['manual'])
      expect(result.total).toBe(1)
      const where = db.refundTransaction.findMany.mock.calls[0]![0].where
      expect(where.AND?.[0]).toEqual({ status: 'manual_required' })
      expect(db.refundTransaction.count).toHaveBeenCalledWith({ where })
    },
  )

  it('combines method and source filters and leaves the unfiltered counts unchanged', async () => {
    const returned = refund('return')
    returned.sourceType = 'return_request'
    const { prisma } = buildPrisma([
      refund('cancel'),
      returned,
      refund('card', 'manual_required', 'card'),
      refund('missing', 'manual_required', null),
    ])
    const svc = createAdminRefundQueryService({ prisma })
    expect(
      (
        await svc.listManualRequiredForAdmin({ method: 'eft', sourceType: 'return_request' })
      ).rows.map((row) => row.id),
    ).toEqual(['return'])
    expect(
      (await svc.listManualRequiredForAdmin({ method: 'missing' })).rows.map((row) => row.id),
    ).toEqual(['missing'])
    expect((await svc.getCounts()).pendingManualRefunds).toBe(4)
  })

  it('does not broaden failed card status guards when searching or filtering', async () => {
    const { prisma, db } = buildPrisma([
      refund('failed', 'failed', 'card'),
      refund('manual', 'manual_required', 'card'),
      refund('completed', 'completed', 'card'),
      refund('eft-failed', 'failed', 'eft'),
    ])
    const svc = createAdminRefundQueryService({ prisma })
    expect(
      (await svc.listFailedCardForAdmin({ query: '#26050074' })).rows.map((row) => row.id),
    ).toEqual(['failed'])
    const where = db.refundTransaction.findMany.mock.calls[0]![0].where
    expect(where.AND?.[0]?.payment).toEqual({ is: { method: 'card' } })
    expect(where.AND?.[0]?.OR).toHaveLength(2)
    expect((await svc.listFailedCardForAdmin({ method: 'eft' })).total).toBe(0)
  })

  it('paginates search results on the server with a full filtered count', async () => {
    const { prisma } = buildPrisma(
      Array.from({ length: 23 }, (_, i) => refund(String(i).padStart(2, '0'))),
    )
    const result = await createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin({
      query: 'müşteri',
      skip: 20,
      take: 20,
    })
    expect(result.total).toBe(23)
    expect(result.rows.map((row) => row.id)).toEqual(['20', '21', '22'])
  })

  it.each(['999999999999999999999', '1.5', '1e5', "' OR 1=1 --"])(
    'keeps non-public-number input in parameterized string search only: %s',
    async (query) => {
      const { prisma, db } = buildPrisma()
      await createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin({ query })
      const search = db.refundTransaction.findMany.mock.calls[0]![0].where.AND?.[1]?.OR
      expect(search).toHaveLength(3)
      expect(search?.[0]).toEqual({ id: query })
      expect(search?.some((filter) => filter.order?.is.publicNumber)).toBe(false)
    },
  )

  it('keeps the legacy query shape for empty search and no filters', async () => {
    const { prisma, db } = buildPrisma()
    await createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin({ query: '  ' })
    expect(db.refundTransaction.findMany.mock.calls[0]![0].where).toEqual({
      status: 'manual_required',
    })
  })

  it('rejects oversized search before reading the database', async () => {
    const { prisma, db } = buildPrisma()
    await expect(
      createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin({
        query: 'x'.repeat(101),
      }),
    ).rejects.toThrow()
    expect(db.refundTransaction.findMany).not.toHaveBeenCalled()
  })

  it.each([{ method: 'invalid' }, { sourceType: 'invalid' }])(
    'rejects invalid enum filters before querying: %j',
    async (params) => {
      const { prisma, db } = buildPrisma()
      await expect(
        createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin(params as never),
      ).rejects.toThrow()
      expect(db.refundTransaction.findMany).not.toHaveBeenCalled()
    },
  )

  it('lists separate cancellation, return and dispute refunds, including manual card/missing-payment cases', async () => {
    const rows = [
      refund('1'),
      refund('2'),
      refund('3', 'manual_required', 'card'),
      refund('4', 'manual_required', null),
    ]
    rows[1]!.sourceType = 'return_request'
    rows[3]!.sourceType = 'dispute'
    const { prisma, db } = buildPrisma([...rows, refund('5', 'completed'), refund('6', 'pending')])
    const result = await createAdminRefundQueryService({
      prisma,
    }).listManualRequiredForAdmin()

    expect(result.total).toBe(4)
    expect(result.rows.map((row) => row.id)).toEqual(['1', '2', '3', '4'])
    expect(result.rows.map((row) => row.orderId)).toEqual(Array(4).fill('same-order'))
    expect(result.rows[3]!.payment).toBeNull()
    expect(db.refundTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'manual_required' },
        skip: 0,
        take: 50,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    )
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Array), {
      isolationLevel: 'RepeatableRead',
    })
  })

  it('keeps failed and partially failed card refunds visible before and after retries', async () => {
    const early = refund('early', 'failed', 'card')
    early.items[0]!.attemptCount = 1
    const exhausted = refund('exhausted', 'failed', 'card')
    exhausted.items[0]!.attemptCount = 5
    const partial = refund('partial', 'partially_completed', 'card')
    partial.items.push({
      ...partial.items[0]!,
      id: 'done',
      status: 'completed',
    })
    const progressing = refund('progressing', 'partially_completed', 'card')
    progressing.items[0]!.status = 'pending'
    const { prisma, db } = buildPrisma([
      early,
      exhausted,
      partial,
      progressing,
      refund('eft-failed', 'failed'),
      refund('done', 'completed', 'card'),
      refund('manual', 'manual_required', 'card'),
      refund('pending', 'pending', 'card'),
      refund('processing', 'processing', 'card'),
    ])
    const result = await createAdminRefundQueryService({
      prisma,
    }).listFailedCardForAdmin()

    expect(result.rows.map((row) => row.id)).toEqual(['early', 'exhausted', 'partial'])
    expect(result.total).toBe(3)
    expect(db.refundTransaction.count).toHaveBeenCalledWith({
      where: {
        payment: { is: { method: 'card' } },
        OR: [
          { status: 'failed' },
          {
            status: 'partially_completed',
            items: { some: { status: 'failed' } },
          },
        ],
      },
    })
  })

  it('uses the same predicates for lists and counters and removes completed refunds on the next read', async () => {
    const manual = refund('manual')
    const card = refund('card', 'partially_completed', 'card')
    const { prisma, db } = buildPrisma([manual, card])
    const service = createAdminRefundQueryService({ prisma })
    expect(await service.getCounts()).toEqual({
      pendingManualRefunds: 1,
      failedCardRefunds: 1,
    })
    const countFilters = db.refundTransaction.count.mock.calls.map(([args]) => args.where)
    await service.listManualRequiredForAdmin()
    await service.listFailedCardForAdmin()
    expect(db.refundTransaction.findMany.mock.calls.map(([args]) => args.where)).toEqual(
      countFilters,
    )

    manual.status = 'completed'
    card.status = 'completed'
    expect(await service.getCounts()).toEqual({
      pendingManualRefunds: 0,
      failedCardRefunds: 0,
    })
    expect(await service.listManualRequiredForAdmin()).toEqual({
      rows: [],
      total: 0,
    })
    expect(await service.listFailedCardForAdmin()).toEqual({
      rows: [],
      total: 0,
    })
  })

  it('returns only unpaid item amounts with exact monetary strings after partial success', async () => {
    const row = refund('partial', 'partially_completed', 'card')
    row.customerAmount = new Decimal('77121.00')
    row.items.push({ ...row.items[0]!, id: 'paid', status: 'completed' })
    const { prisma } = buildPrisma([row])
    const { rows } = await createAdminRefundQueryService({
      prisma,
    }).listFailedCardForAdmin()
    expect(rows[0]!.customerAmount).toBe('77121.00')
    expect(rows[0]!.outstandingAmount).toBe('38560.50')
    expect(rows[0]!.items[0]!.amount).toBe('38560.50')
    expect(row.items[0]!.amount).toBeInstanceOf(Decimal)
  })

  it('preserves cents when summing product/shipping items', async () => {
    const row = refund('cents')
    row.items[0]!.amount = new Decimal('0.10')
    row.items.push({
      ...row.items[0]!,
      id: 'shipping',
      amount: new Decimal('0.20'),
    })
    const { prisma } = buildPrisma([row])
    const { rows } = await createAdminRefundQueryService({
      prisma,
    }).listManualRequiredForAdmin()
    expect(rows[0]!.outstandingAmount).toBe('0.30')
  })

  it('does not invent a remaining amount when item records are missing', async () => {
    const row = refund('no-items')
    row.items = []
    const { prisma } = buildPrisma([row])
    const { rows } = await createAdminRefundQueryService({
      prisma,
    }).listManualRequiredForAdmin()
    expect(rows[0]!.outstandingAmount).toBeNull()
  })

  it('returns full queue counts beyond the page limit and orders oldest first', async () => {
    const rows = Array.from({ length: 52 }, (_, i) => refund(String(i).padStart(2, '0')))
    rows[51]!.createdAt = new Date('2026-09-02T10:00:00Z')
    const { prisma } = buildPrisma(rows)
    const service = createAdminRefundQueryService({ prisma })
    const firstPage = await service.listManualRequiredForAdmin()
    const nextPage = await service.listManualRequiredForAdmin({
      skip: 50,
      take: 5,
    })
    expect(firstPage.rows).toHaveLength(50)
    expect(firstPage.rows[0]!.id).toBe('51')
    expect(firstPage.total).toBe(52)
    expect(nextPage.rows.map((row) => row.id)).toEqual(['49', '50'])
    expect(nextPage.total).toBe(52)
    expect((await service.getCounts()).pendingManualRefunds).toBe(52)
  })

  it.each([{ skip: -1 }, { skip: 1.5 }, { take: 0 }, { take: 101 }, { take: NaN }])(
    'rejects invalid pagination before querying: %j',
    async (params) => {
      const { prisma, db } = buildPrisma()
      await expect(
        createAdminRefundQueryService({ prisma }).listManualRequiredForAdmin(params),
      ).rejects.toThrow()
      expect(db.refundTransaction.findMany).not.toHaveBeenCalled()
    },
  )

  it('selects only queue fields, not customer contacts, bank details or raw provider data', async () => {
    const { prisma, db } = buildPrisma()
    await createAdminRefundQueryService({
      prisma,
    }).listManualRequiredForAdmin()
    expect(db.refundTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          order: {
            select: {
              publicNumber: true,
              currency: true,
              customer: { select: { id: true, name: true } },
            },
          },
          payment: { select: { method: true, provider: true } },
        }),
      }),
    )
  })

  it('propagates database failures instead of pretending there are no refunds', async () => {
    const { prisma, db } = buildPrisma()
    db.refundTransaction.count.mockRejectedValue(new Error('DB unavailable'))
    await expect(createAdminRefundQueryService({ prisma }).getCounts()).rejects.toThrow(
      'DB unavailable',
    )
  })

  it('wires the real refund counters into admin dashboard stats', async () => {
    const { db } = buildPrisma([refund('1'), refund('2'), refund('card', 'failed', 'card')])
    const countModel = () => ({ count: vi.fn(async () => 0) })
    const prisma = {
      ...db,
      order: countModel(),
      returnRequest: countModel(),
      dispute: countModel(),
      payment: {
        ...countModel(),
        aggregate: vi.fn(async () => ({ _sum: { amount: null } })),
      },
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
    const stats = await createAdminAnalyticsService({
      prisma,
    }).getDashboardStats()
    expect(stats.payments).toEqual({
      pendingEftApprovals: 0,
      pendingManualRefunds: 2,
      failedCardRefunds: 1,
      collectedToday: 0,
    })
  })
})
