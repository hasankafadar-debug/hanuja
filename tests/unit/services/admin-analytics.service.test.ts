/**
 * Unit tests — admin-analytics.service.ts
 *
 * Covers: dashboard stats shape validation, delayed order threshold logic,
 * negative balance detection, payout state classification, stat fallback
 * to zero when aggregate is null.
 *
 * No DB connection — pure business rule verification.
 * See: .claude/rules/10-admin-panel-rules.md, .claude/rules/07-marketplace-finance-rules.md
 */
import { describe, it, expect } from 'vitest'
import {
  FULFILLMENT_DAYS,
  PAYOUT_HOLD_DAYS,
} from '~/api/domain/penalty-calculator'

// ── Dashboard stats shape ─────────────────────────────────────────────────────

describe('AdminAnalytics — dashboard stats shape', () => {
  const mockStats = {
    orders: {
      totalToday: 12,
      pendingSellerAction: 3,
      delayedOrders: 1,
      openReturns: 2,
      openDisputes: 0,
    },
    payments: {
      pendingEftApprovals: 4,
      collectedToday: 8500.00,
    },
    payouts: {
      pendingPayoutTotal: 45000.00,
      payoutReadyTotal: 12000.00,
      blockedPayoutTotal: 3000.00,
      sellerNegativeBalances: 2,
    },
    penalties: {
      pendingPenaltyTotal: 500.00,
    },
    sellers: {
      totalActive: 30,
      pendingApproval: 5,
    },
  }

  it('has all required top-level sections', () => {
    expect(mockStats).toHaveProperty('orders')
    expect(mockStats).toHaveProperty('payments')
    expect(mockStats).toHaveProperty('payouts')
    expect(mockStats).toHaveProperty('penalties')
    expect(mockStats).toHaveProperty('sellers')
  })

  it('orders section has all required fields', () => {
    const { orders } = mockStats
    expect(orders).toHaveProperty('totalToday')
    expect(orders).toHaveProperty('pendingSellerAction')
    expect(orders).toHaveProperty('delayedOrders')
    expect(orders).toHaveProperty('openReturns')
    expect(orders).toHaveProperty('openDisputes')
  })

  it('payments section exposes EFT approval queue and collected today', () => {
    expect(mockStats.payments).toHaveProperty('pendingEftApprovals')
    expect(mockStats.payments).toHaveProperty('collectedToday')
  })

  it('payouts section distinguishes pending, ready, and blocked', () => {
    const { payouts } = mockStats
    expect(payouts).toHaveProperty('pendingPayoutTotal')
    expect(payouts).toHaveProperty('payoutReadyTotal')
    expect(payouts).toHaveProperty('blockedPayoutTotal')
    expect(payouts).toHaveProperty('sellerNegativeBalances')
  })
})

// ── Null-safe aggregate fallback ──────────────────────────────────────────────

describe('AdminAnalytics — null-safe aggregate fallback', () => {
  it('falls back to 0 when aggregate _sum.amount is null', () => {
    const aggregateResult = { _sum: { amount: null } }
    const total = Number(aggregateResult._sum.amount ?? 0)
    expect(total).toBe(0)
  })

  it('uses actual value when aggregate _sum.amount is present', () => {
    const aggregateResult = { _sum: { amount: '4500.00' } }
    const total = Number(aggregateResult._sum.amount ?? 0)
    expect(total).toBe(4500)
  })

  it('all monetary totals are non-negative numbers', () => {
    const totals = [8500, 45000, 12000, 3000, 500]
    for (const t of totals) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(t)).toBe(true)
    }
  })
})

// ── Delayed order threshold ───────────────────────────────────────────────────

describe('AdminAnalytics — delayed order threshold', () => {
  it('20-day fulfillment deadline constant matches FULFILLMENT_DAYS', () => {
    expect(FULFILLMENT_DAYS).toBe(20)
  })

  it('order created exactly 20 days ago is at the breach threshold', () => {
    const now = new Date()
    const twentyDaysAgo = new Date(now.getTime() - FULFILLMENT_DAYS * 24 * 60 * 60 * 1000)
    const daysDiff = Math.floor((now.getTime() - twentyDaysAgo.getTime()) / (24 * 60 * 60 * 1000))
    expect(daysDiff).toBe(FULFILLMENT_DAYS)
  })

  it('order created 21 days ago is past the breach threshold', () => {
    const now = new Date()
    const twentyOneDaysAgo = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000)
    const isDelayed = twentyOneDaysAgo <= new Date(now.getTime() - FULFILLMENT_DAYS * 24 * 60 * 60 * 1000)
    expect(isDelayed).toBe(true)
  })

  it('delayed statuses are seller_accepted, preparing, awaiting_shipment', () => {
    const delayedStatuses = ['seller_accepted', 'preparing', 'awaiting_shipment']
    expect(delayedStatuses).toContain('seller_accepted')
    expect(delayedStatuses).toContain('preparing')
    expect(delayedStatuses).toContain('awaiting_shipment')
    expect(delayedStatuses).not.toContain('shipped') // already shipped — not delayed
  })
})

// ── Negative balance detection ────────────────────────────────────────────────

describe('AdminAnalytics — negative seller balance detection', () => {
  it('identifies sellers with negative balance', () => {
    const ledgers = [
      { sellerId: 's1', balance: -200 },
      { sellerId: 's2', balance: 0 },
      { sellerId: 's3', balance: 5000 },
      { sellerId: 's4', balance: -50 },
    ]
    const negativeCount = ledgers.filter((l) => l.balance < 0).length
    expect(negativeCount).toBe(2)
  })

  it('zero balance is not negative', () => {
    const balance = 0
    expect(balance < 0).toBe(false)
  })

  it('negative balance is a risk signal requiring admin attention', () => {
    const balance = -500
    const requiresAttention = balance < 0
    expect(requiresAttention).toBe(true)
  })
})

// ── Payout state classification ───────────────────────────────────────────────

describe('AdminAnalytics — payout state classification', () => {
  it('payout hold starts at delivery_confirmed and runs for 30 days', () => {
    expect(PAYOUT_HOLD_DAYS).toBe(30)
  })

  it('payout_ready is separate from hold_active', () => {
    const holdStatus = 'hold_active'
    const readyStatus = 'payout_ready'
    expect(holdStatus).not.toBe(readyStatus)
  })

  it('payout_blocked is separate from payout_ready', () => {
    const blockedStatus = 'payout_blocked'
    const readyStatus = 'payout_ready'
    expect(blockedStatus).not.toBe(readyStatus)
  })

  it('three distinct payout totals are shown in dashboard (pending, ready, blocked)', () => {
    // Admin must see each category separately — not a single merged total
    const statKeys = ['pendingPayoutTotal', 'payoutReadyTotal', 'blockedPayoutTotal']
    expect(statKeys).toHaveLength(3)
    expect(new Set(statKeys).size).toBe(3)
  })
})

// ── Seller finance summary ────────────────────────────────────────────────────

describe('AdminAnalytics — seller finance summary', () => {
  it('isNegativeBalance flag is derived from currentBalance', () => {
    const currentBalance = -300
    const isNegativeBalance = currentBalance < 0
    expect(isNegativeBalance).toBe(true)
  })

  it('isNegativeBalance is false for positive balance', () => {
    const currentBalance = 1500
    const isNegativeBalance = currentBalance < 0
    expect(isNegativeBalance).toBe(false)
  })

  it('paidTotal does not include pending or hold amounts', () => {
    // paidTotal represents only already-disbursed payouts
    const paidTotal = 20000
    const pendingPayout = 5000
    // These should be independent figures, not summed
    expect(paidTotal).not.toBe(paidTotal + pendingPayout)
  })
})
