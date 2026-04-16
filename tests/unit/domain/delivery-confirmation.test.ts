/**
 * Unit tests — delivery-confirmation.ts
 * delivered ≠ delivery_confirmed. Payout starts only from delivery_confirmed.
 * 08-order-lifecycle-rules.md
 */
import { describe, it, expect } from 'vitest'
import {
  isSilentConfirmationEligible,
  buildCustomerConfirmation,
  buildAdminConfirmation,
  buildSilentConfirmation,
} from '../../../api/domain/delivery-confirmation'

// Helper: create a Date N hours before a reference point
function hoursAgo(hours: number, from = new Date()): Date {
  return new Date(from.getTime() - hours * 60 * 60 * 1000)
}

describe('isSilentConfirmationEligible', () => {
  it('returns true when delivered 72+ hours ago with no open return/dispute', () => {
    const deliveredAt = hoursAgo(73)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: false }),
    ).toBe(true)
  })

  it('returns false when less than 72 hours have elapsed', () => {
    const deliveredAt = hoursAgo(71)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: false }),
    ).toBe(false)
  })

  it('returns false at exactly 71h 59m elapsed', () => {
    const deliveredAt = hoursAgo(0, new Date()) // delivered "now" in the future via now param
    const now = new Date(deliveredAt.getTime() + 71 * 60 * 60 * 1000 + 59 * 60 * 1000)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: false, now }),
    ).toBe(false)
  })

  it('returns true at exactly 72 hours elapsed', () => {
    const deliveredAt = new Date('2026-04-01T10:00:00Z')
    const now = new Date('2026-04-04T10:00:00Z') // exactly 72h later
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: false, now }),
    ).toBe(true)
  })

  it('returns false when open return exists, even after 72h', () => {
    const deliveredAt = hoursAgo(96)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: true, hasOpenDispute: false }),
    ).toBe(false)
  })

  it('returns false when open dispute exists, even after 72h', () => {
    const deliveredAt = hoursAgo(96)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: true }),
    ).toBe(false)
  })

  it('returns false when both open return and dispute exist', () => {
    const deliveredAt = hoursAgo(120)
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: true, hasOpenDispute: true }),
    ).toBe(false)
  })

  it('accepts an explicit `now` param for deterministic testing', () => {
    const deliveredAt = new Date('2026-03-01T00:00:00Z')
    const now = new Date('2026-03-04T01:00:00Z') // 73h later
    expect(
      isSilentConfirmationEligible({ deliveredAt, hasOpenReturn: false, hasOpenDispute: false, now }),
    ).toBe(true)
  })
})

describe('buildCustomerConfirmation', () => {
  it('returns confirmed=true with source customer_explicit', () => {
    const result = buildCustomerConfirmation()
    expect(result.confirmed).toBe(true)
    expect(result.source).toBe('customer_explicit')
    expect(result.confirmedAt).toBeInstanceOf(Date)
  })

  it('uses the provided timestamp', () => {
    const ts = new Date('2026-04-08T12:00:00Z')
    const result = buildCustomerConfirmation(ts)
    expect(result.confirmedAt).toBe(ts)
  })
})

describe('buildAdminConfirmation', () => {
  it('returns confirmed=true with source admin_manual', () => {
    const result = buildAdminConfirmation()
    expect(result.confirmed).toBe(true)
    expect(result.source).toBe('admin_manual')
    expect(result.confirmedAt).toBeInstanceOf(Date)
  })

  it('uses the provided timestamp', () => {
    const ts = new Date('2026-04-08T14:00:00Z')
    const result = buildAdminConfirmation(ts)
    expect(result.confirmedAt).toBe(ts)
  })
})

describe('buildSilentConfirmation', () => {
  it('returns confirmed=true with source silent_auto', () => {
    const result = buildSilentConfirmation()
    expect(result.confirmed).toBe(true)
    expect(result.source).toBe('silent_auto')
    expect(result.confirmedAt).toBeInstanceOf(Date)
  })

  it('uses the provided timestamp', () => {
    const ts = new Date('2026-04-08T16:00:00Z')
    const result = buildSilentConfirmation(ts)
    expect(result.confirmedAt).toBe(ts)
  })
})
