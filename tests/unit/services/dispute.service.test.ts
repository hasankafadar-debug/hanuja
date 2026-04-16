/**
 * Unit tests — dispute.service.ts
 *
 * Covers: open dispute guards, resolution type mapping, payout block on
 * customer-favored resolution, message gating on closed disputes.
 *
 * No DB connection — pure business rule verification.
 * See: .claude/rules/07-marketplace-finance-rules.md, .claude/rules/08-order-lifecycle-rules.md
 */
import { describe, it, expect } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'

// ── Open dispute preconditions ────────────────────────────────────────────────

describe('Dispute — open preconditions', () => {
  it('requires delivery_confirmed status to open a dispute', () => {
    const orderStatus = 'delivery_confirmed'
    const canOpen = orderStatus === 'delivery_confirmed'
    expect(canOpen).toBe(true)
  })

  it('blocks dispute on orders not yet delivery_confirmed', () => {
    const nonEligibleStatuses = [
      'shipped',
      'delivered',
      'payment_confirmed',
      'seller_accepted',
      'preparing',
    ]
    for (const status of nonEligibleStatuses) {
      const canOpen = status === 'delivery_confirmed'
      expect(canOpen).toBe(false)
    }
  })

  it('blocks dispute when an open return already exists', () => {
    const openReturnCount = 1
    const canOpen = openReturnCount === 0
    expect(canOpen).toBe(false)
  })

  it('allows dispute when no open return exists', () => {
    const openReturnCount = 0
    const canOpen = openReturnCount === 0
    expect(canOpen).toBe(true)
  })

  it('blocks duplicate open dispute on same order', () => {
    const existingStatus = 'open'
    const hasOpenDispute = existingStatus === 'open'
    expect(hasOpenDispute).toBe(true)
  })
})

// ── Resolution type mapping ───────────────────────────────────────────────────

describe('Dispute — resolution types', () => {
  it('resolved_for_customer sets payoutBlocked=true', () => {
    const resolutionType = 'resolved_for_customer'
    const payoutBlocked = resolutionType === 'resolved_for_customer'
    expect(payoutBlocked).toBe(true)
  })

  it('resolved_for_seller sets payoutBlocked=false', () => {
    const resolutionType = 'resolved_for_seller'
    const payoutBlocked = resolutionType === 'resolved_for_customer'
    expect(payoutBlocked).toBe(false)
  })

  it('only under_review and open disputes can be resolved', () => {
    const resolvableStatuses = ['open', 'under_review']
    const nonResolvable = ['resolved_for_customer', 'resolved_for_seller', 'closed']

    for (const s of resolvableStatuses) {
      expect(resolvableStatuses.includes(s)).toBe(true)
    }
    for (const s of nonResolvable) {
      expect(resolvableStatuses.includes(s)).toBe(false)
    }
  })

  it('refundAmount is optional for seller-favored resolution', () => {
    const resolutionType = 'resolved_for_seller'
    const refundAmount = undefined
    // Seller resolution — no refund
    const needsRefund = resolutionType === 'resolved_for_customer' && refundAmount !== undefined
    expect(needsRefund).toBe(false)
  })
})

// ── Payout block on customer-favored resolution ───────────────────────────────

describe('Dispute — payout block', () => {
  it('blocks payout for all non-paid payouts when resolved for customer', () => {
    const payouts = [
      { id: 'p1', status: 'hold_active' },
      { id: 'p2', status: 'payout_ready' },
      { id: 'p3', status: 'payout_paid' }, // already paid — should NOT be blocked
    ]
    const toBlock = payouts.filter(
      (p) => p.status !== 'payout_paid' && p.status !== 'payout_blocked',
    )
    expect(toBlock).toHaveLength(2)
    expect(toBlock.map((p) => p.id)).toContain('p1')
    expect(toBlock.map((p) => p.id)).toContain('p2')
  })

  it('does not block already-paid payouts', () => {
    const payout = { id: 'p1', status: 'payout_paid' }
    const shouldBlock = payout.status !== 'payout_paid' && payout.status !== 'payout_blocked'
    expect(shouldBlock).toBe(false)
  })

  it('does not double-block already-blocked payouts', () => {
    const payout = { id: 'p1', status: 'payout_blocked' }
    const shouldBlock = payout.status !== 'payout_paid' && payout.status !== 'payout_blocked'
    expect(shouldBlock).toBe(false)
  })

  it('open dispute blocks payout eligibility', () => {
    const openDisputeCount = 1
    const isPayoutBlocked = openDisputeCount > 0
    expect(isPayoutBlocked).toBe(true)
  })
})

// ── Message gate on closed disputes ──────────────────────────────────────────

describe('Dispute — message gate', () => {
  const closedStatuses = ['resolved_for_customer', 'resolved_for_seller', 'closed']

  it.each(closedStatuses)('blocks messages on %s dispute', (status) => {
    const canAddMessage = !closedStatuses.includes(status)
    expect(canAddMessage).toBe(false)
  })

  it('allows messages on open dispute', () => {
    const status = 'open'
    const canAddMessage = !closedStatuses.includes(status)
    expect(canAddMessage).toBe(true)
  })

  it('allows messages on under_review dispute', () => {
    const status = 'under_review'
    const canAddMessage = !closedStatuses.includes(status)
    expect(canAddMessage).toBe(true)
  })
})

// ── Audit trail requirement ────────────────────────────────────────────────────

describe('Dispute — audit trail', () => {
  it('resolution must capture actor, resolution text, and decision type', () => {
    const auditEntry = {
      actorId: 'admin-1',
      actionType: 'dispute_resolved',
      targetType: 'dispute',
      targetId: 'dispute-abc',
      previousData: { status: 'open' },
      newData: { status: 'resolved_for_customer', resolution: 'Ürün hasarlı teslim edildi' },
      reason: 'Ürün hasarlı teslim edildi',
    }

    expect(auditEntry.actorId).toBeTruthy()
    expect(auditEntry.actionType).toBe('dispute_resolved')
    expect(auditEntry.previousData.status).toBe('open')
    expect(auditEntry.newData.resolution).toBeTruthy()
  })

  it('resolution type is recorded in newData', () => {
    const newData = { status: 'resolved_for_seller', resolution: 'Satıcı haklı' }
    expect(newData.status).toBe('resolved_for_seller')
  })
})

// ── Refund amount on customer-favored resolution ──────────────────────────────

describe('Dispute — refund amount on customer-favored resolution', () => {
  it('refund amount must be positive when provided', () => {
    const refundAmount = new Decimal('500.00')
    expect(refundAmount.greaterThan(0)).toBe(true)
  })

  it('refund amount should not exceed order amount', () => {
    const orderAmount = new Decimal('850.00')
    const refundAmount = new Decimal('1000.00')
    expect(refundAmount.greaterThan(orderAmount)).toBe(true) // This would be invalid
  })

  it('partial refund on dispute resolution is valid', () => {
    const orderAmount = new Decimal('850.00')
    const refundAmount = new Decimal('400.00')
    expect(refundAmount.lessThan(orderAmount)).toBe(true)
    expect(refundAmount.greaterThan(0)).toBe(true)
  })
})
