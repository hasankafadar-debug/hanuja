import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  getOverdueSellerApproval,
  SELLER_APPROVAL_WAIT_MS,
  type SellerApprovalCandidate,
} from '../../../api/domain/seller-approval-overdue'
import { createSellerApprovalQueryService } from '../../../api/services/seller-approval-query.service'

const now = new Date('2026-09-21T12:00:00Z')
const start = new Date(now.getTime() - SELLER_APPROVAL_WAIT_MS)
function order(overrides: Partial<SellerApprovalCandidate> = {}): SellerApprovalCandidate {
  return {
    id: 'order-1', status: 'seller_queue_ready', quantityLifecycleVersion: 2,
    sellerQueueReadyAt: start, paymentConfirmedAt: start, cancelledAt: null,
    lines: [{ sellerId: 'seller-1', quantity: 2, cancelledQuantity: 0, shippedQuantity: 0 }],
    sellerFulfillments: [{ sellerId: 'seller-1', status: 'queue_ready', acceptedAt: null }],
    ...overrides,
  }
}

describe('24-hour seller approval deadline', () => {
  it('starts exactly at 24 hours, including weekends', () => {
    expect(getOverdueSellerApproval(order(), new Date(now.getTime() - 1))).toBeNull()
    expect(getOverdueSellerApproval(order(), now)?.sellerIds).toEqual(['seller-1'])
    expect(getOverdueSellerApproval(order(), new Date(now.getTime() + 1))).not.toBeNull()
  })

  it('prefers the seller queue timestamp and falls back only to payment confirmation', () => {
    expect(getOverdueSellerApproval(order({ sellerQueueReadyAt: now }), now)).toBeNull()
    expect(getOverdueSellerApproval(order({ sellerQueueReadyAt: null }), now)?.waitingSince).toEqual(start)
    expect(getOverdueSellerApproval(order({ sellerQueueReadyAt: null, paymentConfirmedAt: null }), now)).toBeNull()
  })

  it.each(['bank_transfer_waiting', 'payment_pending', 'payment_failed'] as const)(
    'does not alert for unconfirmed payment state %s even with stale timestamps', (status) => {
      expect(getOverdueSellerApproval(order({ status }), now)).toBeNull()
    },
  )

  it('starts a fresh deadline when EFT is approved after days of waiting', () => {
    expect(getOverdueSellerApproval(order({ sellerQueueReadyAt: now, paymentConfirmedAt: now }), now)).toBeNull()
  })

  it('keeps another seller visible after the first seller accepts and the order advances', () => {
    const candidate = order({ status: 'seller_accepted' })
    candidate.lines.push({ sellerId: 'seller-2', quantity: 1, cancelledQuantity: 0, shippedQuantity: 0 })
    candidate.sellerFulfillments[0] = { sellerId: 'seller-1', status: 'accepted', acceptedAt: now }
    candidate.sellerFulfillments.push({ sellerId: 'seller-2', status: 'reviewing', acceptedAt: null })
    expect(getOverdueSellerApproval(candidate, now)?.sellerIds).toEqual(['seller-2'])
    candidate.sellerFulfillments[1] = { sellerId: 'seller-2', status: 'accepted', acceptedAt: now }
    expect(getOverdueSellerApproval(candidate, now)).toBeNull()
  })

  it.each(['accepted', 'cancelled', 'shipped'] as const)('excludes %s seller fulfillments', (status) => {
    expect(getOverdueSellerApproval(order({
      sellerFulfillments: [{ sellerId: 'seller-1', status, acceptedAt: null }],
    }), now)).toBeNull()
  })

  it('excludes fully cancelled/shipped quantities but retains partially cancelled items', () => {
    const candidate = order()
    candidate.lines[0].cancelledQuantity = 1
    expect(getOverdueSellerApproval(candidate, now)).not.toBeNull()
    candidate.lines[0].shippedQuantity = 1
    expect(getOverdueSellerApproval(candidate, now)).toBeNull()
    candidate.lines.push({ sellerId: 'other-seller', quantity: 3, cancelledQuantity: 0, shippedQuantity: 0 })
    expect(getOverdueSellerApproval(candidate, now)).toBeNull()
  })

  it.each(['cancelled_by_customer', 'cancelled_by_admin', 'refund_completed'] as const)(
    'excludes closed order %s despite stale fulfillment state', (status) => {
      expect(getOverdueSellerApproval(order({ status }), now)).toBeNull()
    },
  )

  it('excludes orders with a cancellation timestamp', () => {
    expect(getOverdueSellerApproval(order({ cancelledAt: now }), now)).toBeNull()
  })

  it.each(['seller_queue_ready', 'seller_reviewing'] as const)('supports legacy %s orders', (status) => {
    expect(getOverdueSellerApproval(order({
      status, quantityLifecycleVersion: 1, sellerFulfillments: [],
    }), now)?.sellerIds).toEqual(['seller-1'])
    expect(getOverdueSellerApproval(order({
      status: 'seller_accepted', quantityLifecycleVersion: 1, sellerFulfillments: [],
    }), now)).toBeNull()
  })
})

describe('shared overdue query', () => {
  it('counts orders once, sorts oldest first and removes candidates without active seller items', async () => {
    const multiSeller = order()
    multiSeller.lines.push({ sellerId: 'seller-2', quantity: 1, cancelledQuantity: 0, shippedQuantity: 0 })
    multiSeller.sellerFulfillments.push({ sellerId: 'seller-2', status: 'queue_ready', acceptedAt: null })
    const older = order({ id: 'older', sellerQueueReadyAt: new Date(start.getTime() - 1000) })
    const findMany = vi.fn().mockResolvedValue([multiSeller, order({ id: 'empty', lines: [] }), older])
    const prisma = { order: { findMany } } as unknown as PrismaClient
    const result = await createSellerApprovalQueryService({ prisma }).listOverdueForAdmin({ now })
    expect(result.total).toBe(2)
    expect(result.rows.map((row) => row.orderId)).toEqual(['older', 'order-1'])
    expect(result.rows[1].sellerIds).toEqual(['seller-1', 'seller-2'])
    // Database filtering must preserve null-only fallback and the inclusive boundary.
    expect(findMany.mock.calls[0][0].where.AND[0].OR).toEqual([
      { sellerQueueReadyAt: { lte: start } },
      { sellerQueueReadyAt: null, paymentConfirmedAt: { lte: start } },
    ])
  })

  it('returns an empty queue when there are no overdue orders', async () => {
    const prisma = { order: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaClient
    expect(await createSellerApprovalQueryService({ prisma }).listOverdueForAdmin({ now }))
      .toEqual({ total: 0, rows: [] })
  })
})
