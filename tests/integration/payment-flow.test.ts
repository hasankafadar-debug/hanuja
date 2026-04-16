/**
 * Integration tests — payment confirmation flow
 *
 * Verifies the finance-critical invariant:
 * Sellers must NOT see orders until payment is confirmed.
 * 08-order-lifecycle-rules.md, 07-marketplace-finance-rules.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OrderStatus } from '../__mocks__/prisma-client'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  canTransition,
  assertTransition,
  isSellerVisible,
} from '../../api/domain/order-state-machine'
import {
  NotFoundError,
  ConflictError,
  InvalidTransitionError,
} from '../../api/lib/errors'

// ─── Mock builder helpers ──────────────────────────────────────────────────────

function makeOrder(overrides: Partial<{ status: OrderStatus; id: string; sellerId: string }> = {}) {
  return {
    id: 'ord-001',
    status: OrderStatus.payment_pending,
    sellerId: 'sel-001',
    customerId: 'cust-001',
    createdAt: new Date('2026-04-01T10:00:00Z'),
    paymentConfirmedAt: null as Date | null,
    ...overrides,
  }
}

// ─── Payment confirmation lifecycle ───────────────────────────────────────────

describe('payment confirmation → seller visibility', () => {
  it('payment_pending → seller_queue_ready requires payment_confirmed in between', () => {
    // Direct skip is not allowed
    expect(canTransition(OrderStatus.payment_pending, OrderStatus.seller_queue_ready)).toBe(false)

    // Must go through payment_confirmed
    expect(canTransition(OrderStatus.payment_pending, OrderStatus.payment_confirmed)).toBe(true)
    expect(canTransition(OrderStatus.payment_confirmed, OrderStatus.seller_queue_ready)).toBe(true)
  })

  it('seller cannot see order at payment_pending', () => {
    const order = makeOrder({ status: OrderStatus.payment_pending })
    expect(isSellerVisible(order.status)).toBe(false)
  })

  it('seller cannot see order at payment_failed', () => {
    const order = makeOrder({ status: OrderStatus.payment_failed })
    expect(isSellerVisible(order.status)).toBe(false)
  })

  it('seller cannot see order at bank_transfer_waiting', () => {
    const order = makeOrder({ status: OrderStatus.bank_transfer_waiting })
    expect(isSellerVisible(order.status)).toBe(false)
  })

  it('seller cannot see order at payment_confirmed (not yet in queue)', () => {
    // payment_confirmed is an internal transition state — seller queue comes next
    const order = makeOrder({ status: OrderStatus.payment_confirmed })
    expect(isSellerVisible(order.status)).toBe(false)
  })

  it('seller CAN see order at seller_queue_ready', () => {
    const order = makeOrder({ status: OrderStatus.seller_queue_ready })
    expect(isSellerVisible(order.status)).toBe(true)
  })
})

// ─── Bank transfer / EFT confirmation path ────────────────────────────────────

describe('bank transfer confirmation path', () => {
  it('bank_transfer_waiting → bank_transfer_confirmed → payment_confirmed', () => {
    expect(canTransition(OrderStatus.bank_transfer_waiting, OrderStatus.bank_transfer_confirmed)).toBe(true)
    expect(canTransition(OrderStatus.bank_transfer_confirmed, OrderStatus.payment_confirmed)).toBe(true)
  })

  it('bank_transfer_waiting → seller_queue_ready is NOT allowed (must be confirmed first)', () => {
    expect(canTransition(OrderStatus.bank_transfer_waiting, OrderStatus.seller_queue_ready)).toBe(false)
  })

  it('bank_transfer_waiting can be cancelled', () => {
    expect(canTransition(OrderStatus.bank_transfer_waiting, OrderStatus.payment_cancelled)).toBe(true)
  })

  it('bank_transfer_confirmed → seller_queue_ready is NOT a valid shortcut', () => {
    expect(canTransition(OrderStatus.bank_transfer_confirmed, OrderStatus.seller_queue_ready)).toBe(false)
  })

  it('seller is NOT visible at bank_transfer_confirmed (payment not fully processed)', () => {
    expect(isSellerVisible(OrderStatus.bank_transfer_confirmed)).toBe(false)
  })
})

// ─── Payment retry path ───────────────────────────────────────────────────────

describe('payment retry path', () => {
  it('payment_failed → payment_pending allows retry', () => {
    expect(canTransition(OrderStatus.payment_failed, OrderStatus.payment_pending)).toBe(true)
  })

  it('payment_failed → seller_queue_ready is blocked', () => {
    expect(canTransition(OrderStatus.payment_failed, OrderStatus.seller_queue_ready)).toBe(false)
  })

  it('payment_failed → payment_confirmed is blocked (must retry through pending)', () => {
    expect(canTransition(OrderStatus.payment_failed, OrderStatus.payment_confirmed)).toBe(false)
  })
})

// ─── assertTransition throws for unauthorized direct jumps ────────────────────

describe('assertTransition enforcement for payment states', () => {
  it('throws when attempting to move payment_pending → delivered directly', () => {
    expect(() =>
      assertTransition(OrderStatus.payment_pending, OrderStatus.delivered),
    ).toThrow(InvalidTransitionError)
  })

  it('throws when draft jumps to seller_queue_ready', () => {
    expect(() =>
      assertTransition(OrderStatus.draft, OrderStatus.seller_queue_ready),
    ).toThrow(InvalidTransitionError)
  })

  it('does not throw for the confirmed → queue transition', () => {
    expect(() =>
      assertTransition(OrderStatus.payment_confirmed, OrderStatus.seller_queue_ready),
    ).not.toThrow()
  })
})

// ─── Finance service guard simulations ────────────────────────────────────────

describe('finance guard: seller cannot act on unconfirmed orders', () => {
  /**
   * These tests simulate what the order.service.ts sellerAccept() does:
   * 1. findByIdForSeller() returns null if order not in seller-visible state
   * 2. assertTransition() prevents invalid moves
   *
   * The DB-level ownership filter is integration-tested via the repository;
   * here we validate the state machine logic that underpins it.
   */

  it('seller_accepted is a valid target from seller_queue_ready', () => {
    const order = makeOrder({ status: OrderStatus.seller_queue_ready })
    expect(() =>
      assertTransition(order.status, OrderStatus.seller_accepted),
    ).not.toThrow()
  })

  it('seller cannot accept an order still at payment_pending (forbidden)', () => {
    const order = makeOrder({ status: OrderStatus.payment_pending })
    expect(() =>
      assertTransition(order.status, OrderStatus.seller_accepted),
    ).toThrow()
  })

  it('seller cannot reject a payment_pending order', () => {
    const order = makeOrder({ status: OrderStatus.payment_pending })
    expect(() =>
      assertTransition(order.status, OrderStatus.seller_rejected),
    ).toThrow()
  })
})

// ─── Error type assertions ────────────────────────────────────────────────────

describe('error types', () => {
  it('InvalidTransitionError is an instance of Error', () => {
    try {
      assertTransition(OrderStatus.draft, OrderStatus.delivered)
    } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect(e).toBeInstanceOf(InvalidTransitionError)
    }
  })

  it('NotFoundError has status 404', () => {
    const err = new NotFoundError('Order', 'ord-999')
    expect(err.statusCode).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toContain('ord-999')
  })

  it('ConflictError has status 409', () => {
    const err = new ConflictError('Sipariş zaten kargoda')
    expect(err.statusCode).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })
})
