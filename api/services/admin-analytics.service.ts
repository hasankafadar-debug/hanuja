/**
 * Admin Analytics Service — aggregated dashboard statistics.
 *
 * All figures are computed from PostgreSQL (source of truth).
 * Never derived from Meilisearch or frontend assumptions.
 *
 * These stats are read-only aggregations — no state mutations occur here.
 */
import type { PrismaClient } from '@prisma/client'

export interface AdminDashboardStats {
  orders: {
    totalToday: number
    pendingSellerAction: number
    delayedOrders: number
    openReturns: number
    openDisputes: number
  }
  payments: {
    pendingEftApprovals: number
    collectedToday: number
  }
  payouts: {
    pendingPayoutTotal: number
    payoutReadyTotal: number
    blockedPayoutTotal: number
    sellerNegativeBalances: number
  }
  penalties: {
    pendingPenaltyTotal: number
  }
  sellers: {
    totalActive: number
    pendingApproval: number
    pendingImportPermissions: number
  }
}

export interface SellerFinanceSummary {
  sellerId: string
  storeName: string
  pendingPayout: number
  payoutReady: number
  paidTotal: number
  commissionDeducted: number
  penaltyDeducted: number
  currentBalance: number
  isNegativeBalance: boolean
}

export function createAdminAnalyticsService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps

  async function getDashboardStats(): Promise<AdminDashboardStats> {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    // Run all aggregations in parallel for performance
    const [
      totalOrdersToday,
      pendingSellerAction,
      openReturns,
      openDisputes,
      pendingEftApprovals,
      collectedTodayResult,
      pendingPayoutResult,
      payoutReadyResult,
      blockedPayoutResult,
      negativeBalanceCount,
      pendingPenaltyResult,
      activeSellers,
      pendingSellers,
      pendingImportPermissions,
    ] = await Promise.all([
      prisma.order.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.order.count({
        where: { status: { in: ['seller_queue_ready', 'seller_reviewing'] } },
      }),
      prisma.returnRequest.count({
        where: { status: { in: ['requested', 'under_review'] } },
      }),
      prisma.dispute.count({
        where: { status: 'open' },
      }),
      prisma.payment.count({
        where: { method: 'eft', status: 'pending' },
      }),
      prisma.payment.aggregate({
        where: {
          status: 'confirmed',
          confirmedAt: { gte: startOfToday },
        },
        _sum: { amount: true },
      }),
      prisma.payout.aggregate({
        where: { status: 'hold_active' },
        _sum: { netAmount: true },
      }),
      prisma.payout.aggregate({
        where: { status: 'payout_ready' },
        _sum: { netAmount: true },
      }),
      prisma.payout.aggregate({
        where: { status: 'payout_blocked' },
        _sum: { netAmount: true },
      }),
      // Count sellers with net negative ledger balance
      prisma.sellerLedgerEntry.groupBy({
        by: ['sellerId'],
        _sum: { amount: true },
        having: { amount: { _sum: { lt: 0 } } },
      }),
      prisma.penalty.aggregate({
        where: { status: 'applied' },
        _sum: { penaltyAmount: true },
      }),
      prisma.seller.count({ where: { status: 'active' } }),
      prisma.seller.count({ where: { status: 'pending' } }),
      prisma.seller.count({
        where: { importEnabled: false, importRequestedAt: { not: null } },
      }),
    ])

    // Delayed orders: seller_accepted or preparing, created > 20 days ago
    const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000)
    const delayedOrders = await prisma.order.count({
      where: {
        status: { in: ['seller_accepted', 'preparing', 'awaiting_shipment'] },
        createdAt: { lte: twentyDaysAgo },
      },
    })

    return {
      orders: {
        totalToday: totalOrdersToday,
        pendingSellerAction,
        delayedOrders,
        openReturns,
        openDisputes,
      },
      payments: {
        pendingEftApprovals,
        collectedToday: Number(collectedTodayResult._sum.amount ?? 0),
      },
      payouts: {
        pendingPayoutTotal: Number(pendingPayoutResult._sum.netAmount ?? 0),
        payoutReadyTotal: Number(payoutReadyResult._sum.netAmount ?? 0),
        blockedPayoutTotal: Number(blockedPayoutResult._sum.netAmount ?? 0),
        sellerNegativeBalances: negativeBalanceCount.length,
      },
      penalties: {
        pendingPenaltyTotal: Number(pendingPenaltyResult._sum.penaltyAmount ?? 0),
      },
      sellers: {
        totalActive: activeSellers,
        pendingApproval: pendingSellers,
        pendingImportPermissions,
      },
    }
  }

  async function getSellerFinanceSummaries(params: {
    skip?: number
    take?: number
    negativeOnly?: boolean
    query?: string
  }): Promise<{ rows: SellerFinanceSummary[]; total: number }> {
    const normalizedQuery = params.query?.trim()

    const matchingSellers = normalizedQuery
      ? await prisma.seller.findMany({
          where: {
            OR: [
              { displayName: { contains: normalizedQuery, mode: 'insensitive' } },
              { slug: { contains: normalizedQuery, mode: 'insensitive' } },
            ],
          },
          select: { id: true, displayName: true },
        })
      : null

    const matchedSellerIds = matchingSellers?.map((seller) => seller.id)

    const allBalanceAgg = await prisma.sellerLedgerEntry.groupBy({
      by: ['sellerId'],
      ...(matchedSellerIds ? { where: { sellerId: { in: matchedSellerIds } } } : {}),
      _sum: { amount: true },
      ...(params.negativeOnly
        ? { having: { amount: { _sum: { lt: 0 } } } }
        : {}),
      orderBy: { _sum: { amount: 'asc' } },
    })

    const total = allBalanceAgg.length
    const pagedBalanceAgg = allBalanceAgg.slice(
      params.skip ?? 0,
      (params.skip ?? 0) + (params.take ?? 50),
    )

    if (pagedBalanceAgg.length === 0) return { rows: [], total }

    const sellerIds = pagedBalanceAgg.map((b) => b.sellerId)

    const sellers = matchingSellers ?? await prisma.seller.findMany({
      where: { id: { in: sellerIds } },
      select: { id: true, displayName: true },
    })
    const sellerNameMap = new Map(sellers.map((s) => [s.id, s.displayName]))

    // Aggregate payout amounts per seller
    const payoutAgg = await prisma.payout.groupBy({
      by: ['sellerId', 'status'],
      where: { sellerId: { in: sellerIds } },
      _sum: { netAmount: true },
    })

    // Aggregate penalty deductions per seller
    const penaltyAgg = await prisma.penalty.groupBy({
      by: ['sellerId'],
      where: { sellerId: { in: sellerIds }, status: { not: 'waived' } },
      _sum: { penaltyAmount: true },
    })

    const penaltyMap = new Map(
      penaltyAgg.map((p) => [p.sellerId, Number(p._sum.penaltyAmount ?? 0)]),
    )

    const bySellerStatus = new Map<string, Map<string, number>>()
    for (const p of payoutAgg) {
      if (!bySellerStatus.has(p.sellerId)) bySellerStatus.set(p.sellerId, new Map())
      bySellerStatus.get(p.sellerId)!.set(p.status, Number(p._sum.netAmount ?? 0))
    }

    const rows = pagedBalanceAgg.map((b) => {
      const statusMap = bySellerStatus.get(b.sellerId) ?? new Map<string, number>()
      const currentBalance = Number(b._sum?.amount ?? 0)
      return {
        sellerId: b.sellerId,
        storeName: sellerNameMap.get(b.sellerId) ?? b.sellerId,
        pendingPayout: statusMap.get('hold_active') ?? 0,
        payoutReady: statusMap.get('payout_ready') ?? 0,
        paidTotal: statusMap.get('payout_paid') ?? 0,
        commissionDeducted: 0, // Derived from OrderLine if needed in detail view
        penaltyDeducted: penaltyMap.get(b.sellerId) ?? 0,
        currentBalance,
        isNegativeBalance: currentBalance < 0,
      }
    })

    return { rows, total }
  }

  async function getOrderVolumeByDay(days: number = 30): Promise<
    Array<{ date: string; count: number; revenue: number }>
  > {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        status: { notIn: ['payment_pending', 'payment_failed', 'payment_cancelled'] },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
    })

    const byDay = new Map<string, { count: number; revenue: number }>()

    for (const order of orders) {
      const date = order.createdAt.toISOString().slice(0, 10)
      const existing = byDay.get(date) ?? { count: 0, revenue: 0 }
      byDay.set(date, {
        count: existing.count + 1,
        revenue: existing.revenue + Number(order.totalAmount),
      })
    }

    return Array.from(byDay.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }

  return { getDashboardStats, getSellerFinanceSummaries, getOrderVolumeByDay }
}
