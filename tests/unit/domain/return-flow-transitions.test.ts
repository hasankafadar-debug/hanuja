/**
 * Unit tests — seller-driven return → dispute escalation transitions.
 * See: .claude/rules/08-order-lifecycle-rules.md, plan 2026-05-15.
 */
import { describe, it, expect } from 'vitest'
import { OrderStatus } from '../../__mocks__/prisma-client'
import {
  canTransition,
  assertTransition,
  isSellerVisible,
} from '../../../api/domain/order-state-machine'

describe('return flow — seller-driven fast path', () => {
  it('return_requested → return_approved (seller provides cargo info)', () => {
    expect(canTransition(OrderStatus.return_requested, OrderStatus.return_approved)).toBe(true)
  })

  it('return_requested → return_under_review still allowed (admin override)', () => {
    expect(
      canTransition(OrderStatus.return_requested, OrderStatus.return_under_review),
    ).toBe(true)
  })

  it('return_approved → return_in_transit (customer ships)', () => {
    expect(canTransition(OrderStatus.return_approved, OrderStatus.return_in_transit)).toBe(true)
  })

  it('return_in_transit → return_received (seller confirms)', () => {
    expect(canTransition(OrderStatus.return_in_transit, OrderStatus.return_received)).toBe(true)
  })

  it('return_received → refund_pending → refund_completed', () => {
    expect(canTransition(OrderStatus.return_received, OrderStatus.refund_pending)).toBe(true)
    expect(canTransition(OrderStatus.refund_pending, OrderStatus.refund_completed)).toBe(true)
  })
})

describe('return flow — seller rejection escalates to dispute', () => {
  it('return_in_transit → return_rejected (seller rejects received item)', () => {
    expect(canTransition(OrderStatus.return_in_transit, OrderStatus.return_rejected)).toBe(true)
  })

  it('return_rejected → dispute_open (auto-escalation, no longer terminal)', () => {
    expect(canTransition(OrderStatus.return_rejected, OrderStatus.dispute_open)).toBe(true)
  })

  it('dispute_open → dispute_resolved', () => {
    expect(canTransition(OrderStatus.dispute_open, OrderStatus.dispute_resolved)).toBe(true)
  })

  it('assertTransition does not throw on the full reject→dispute path', () => {
    expect(() =>
      assertTransition(OrderStatus.return_in_transit, OrderStatus.return_rejected),
    ).not.toThrow()
    expect(() =>
      assertTransition(OrderStatus.return_rejected, OrderStatus.dispute_open),
    ).not.toThrow()
  })
})

describe('return flow — invalid transitions stay blocked', () => {
  it('return_requested cannot jump straight to return_in_transit', () => {
    expect(canTransition(OrderStatus.return_requested, OrderStatus.return_in_transit)).toBe(false)
  })

  it('return_approved cannot jump to refund_completed', () => {
    expect(canTransition(OrderStatus.return_approved, OrderStatus.refund_completed)).toBe(false)
  })

  it('dispute_resolved is terminal', () => {
    expect(canTransition(OrderStatus.dispute_resolved, OrderStatus.dispute_open)).toBe(false)
  })
})

describe('return flow — seller visibility', () => {
  it('seller still sees return_rejected (escalated to dispute)', () => {
    expect(isSellerVisible(OrderStatus.return_rejected)).toBe(true)
  })
})
