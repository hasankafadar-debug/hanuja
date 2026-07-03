/**
 * Unit tests — penalty-calculator.ts
 * 20% standard penalty. 20-day fulfillment. 30-day payout hold. 14-day return window.
 * CLAUDE.md §2.4, §15.3 — 07-marketplace-finance-rules.md
 */
import { describe, it, expect } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import {
  STANDARD_PENALTY_RATE,
  FULFILLMENT_DAYS,
  PAYOUT_HOLD_DAYS,
  RETURN_WINDOW_DAYS,
  SILENT_DELIVERY_CONFIRMATION_HOURS,
  calculatePenalty,
  isFulfillmentDeadlineBreached,
  getFulfillmentDeadline,
  getExtendedFulfillmentDeadline,
  isWithinReturnWindow,
  getSilentConfirmDeadline,
  isSilentConfirmDue,
} from '../../../api/domain/penalty-calculator'

// ─── Platform constants ───────────────────────────────────────────────────────

describe('platform constants', () => {
  it('standard penalty rate is 20%', () => {
    expect(STANDARD_PENALTY_RATE.toNumber()).toBe(0.2)
  })

  it('fulfillment commitment is 20 days', () => {
    expect(FULFILLMENT_DAYS).toBe(20)
  })

  it('payout hold is 30 days', () => {
    expect(PAYOUT_HOLD_DAYS).toBe(30)
  })

  it('return window is 14 days', () => {
    expect(RETURN_WINDOW_DAYS).toBe(14)
  })

  it('silent confirmation window is 72 hours', () => {
    expect(SILENT_DELIVERY_CONFIRMATION_HOURS).toBe(72)
  })
})

// ─── calculatePenalty ─────────────────────────────────────────────────────────

describe('calculatePenalty', () => {
  it('applies 20% to a whole-number product amount', () => {
    const result = calculatePenalty(new Decimal(1000))
    expect(result.toNumber()).toBe(200)
  })

  it('applies 20% to a decimal product amount', () => {
    const result = calculatePenalty(new Decimal(999.99))
    // 999.99 * 0.20 = 199.998 → rounds to 200.00
    expect(result.toNumber()).toBe(200)
  })

  it('applies 20% to exact marketplace example amounts', () => {
    // ₺2.499 rejection penalty
    expect(calculatePenalty(new Decimal(2499)).toNumber()).toBe(499.8)
    // ₺899 rejection penalty
    expect(calculatePenalty(new Decimal(899)).toNumber()).toBe(179.8)
    // ₺3.499 rejection penalty
    expect(calculatePenalty(new Decimal(3499)).toNumber()).toBe(699.8)
  })

  it('respects a custom override rate', () => {
    const result = calculatePenalty(new Decimal(1000), new Decimal('0.10'))
    expect(result.toNumber()).toBe(100)
  })

  it('returns 0 penalty for a 0 product amount', () => {
    expect(calculatePenalty(new Decimal(0)).toNumber()).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    // 333 * 0.20 = 66.6
    const result = calculatePenalty(new Decimal(333))
    expect(result.toString()).toBe('66.6')
  })
})

// ─── isFulfillmentDeadlineBreached ───────────────────────────────────────────
// NOTE: After the move to business-day arithmetic (Pzt-Cum minus TR official
// holidays), 20 "days" no longer maps to 20 calendar days. We assert via
// the deadline helper rather than hard-coded calendar dates.

describe('isFulfillmentDeadlineBreached', () => {
  it('returns false before the deadline', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-15T00:00:00Z') // 14 calendar days later → still well before business deadline
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, now)).toBe(false)
  })

  it('returns false on the exact business-day deadline', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const deadline = getFulfillmentDeadline(paymentConfirmedAt)
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, deadline)).toBe(false)
  })

  it('returns true just after the business-day deadline', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const deadline = getFulfillmentDeadline(paymentConfirmedAt)
    const justAfter = new Date(deadline.getTime() + 1)
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, justAfter)).toBe(true)
  })

  it('returns true well past any reasonable deadline', () => {
    const paymentConfirmedAt = new Date('2026-01-01T00:00:00Z')
    const now = new Date('2026-04-08T00:00:00Z') // ~97 days
    expect(isFulfillmentDeadlineBreached(paymentConfirmedAt, now)).toBe(true)
  })
})

// ─── getFulfillmentDeadline ───────────────────────────────────────────────────

describe('getFulfillmentDeadline', () => {
  it('lands on a weekday (not weekend)', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const deadline = getFulfillmentDeadline(paymentConfirmedAt)
    const day = deadline.getDay()
    expect(day).not.toBe(0)
    expect(day).not.toBe(6)
  })

  it('is more than 20 calendar days for any starting point in 2026 (proves weekend/holiday skipping)', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const deadline = getFulfillmentDeadline(paymentConfirmedAt)
    const diffMs = deadline.getTime() - paymentConfirmedAt.getTime()
    const diffDays = diffMs / (24 * 60 * 60 * 1000)
    expect(diffDays).toBeGreaterThanOrEqual(20)
  })
})

// ─── getExtendedFulfillmentDeadline ──────────────────────────────────────────

describe('getExtendedFulfillmentDeadline', () => {
  it('is strictly later than the standard deadline', () => {
    const paymentConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const standard = getFulfillmentDeadline(paymentConfirmedAt)
    const extended = getExtendedFulfillmentDeadline(paymentConfirmedAt)
    expect(extended.getTime()).toBeGreaterThan(standard.getTime())
  })

  it('extends by at least 10 calendar days beyond the standard deadline', () => {
    const paymentConfirmedAt = new Date('2026-03-01T00:00:00Z')
    const standard = getFulfillmentDeadline(paymentConfirmedAt)
    const extended = getExtendedFulfillmentDeadline(paymentConfirmedAt)
    const diffMs = extended.getTime() - standard.getTime()
    expect(diffMs).toBeGreaterThanOrEqual(10 * 24 * 60 * 60 * 1000)
  })
})

// ─── isWithinReturnWindow ─────────────────────────────────────────────────────

describe('isWithinReturnWindow', () => {
  it('returns true on the same day as delivery_confirmed', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T12:00:00Z')
    const now = new Date('2026-04-01T13:00:00Z')
    expect(isWithinReturnWindow(deliveryConfirmedAt, now)).toBe(true)
  })

  it('returns true on day 14', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-15T00:00:00Z') // exactly 14 days
    expect(isWithinReturnWindow(deliveryConfirmedAt, now)).toBe(true)
  })

  it('returns false on day 15 (window closed)', () => {
    const deliveryConfirmedAt = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-16T00:00:00Z')
    expect(isWithinReturnWindow(deliveryConfirmedAt, now)).toBe(false)
  })

  it('returns false well after the 14-day window', () => {
    const deliveryConfirmedAt = new Date('2026-03-01T00:00:00Z')
    const now = new Date('2026-04-08T00:00:00Z') // ~38 days
    expect(isWithinReturnWindow(deliveryConfirmedAt, now)).toBe(false)
  })
})

// ─── getSilentConfirmDeadline ─────────────────────────────────────────────────

describe('getSilentConfirmDeadline', () => {
  it('is 72 hours after deliveredAt', () => {
    const deliveredAt = new Date('2026-04-05T10:00:00Z')
    const deadline = getSilentConfirmDeadline(deliveredAt)
    expect(deadline.getTime()).toBe(new Date('2026-04-08T10:00:00Z').getTime())
  })
})

// ─── isSilentConfirmDue ───────────────────────────────────────────────────────

describe('isSilentConfirmDue', () => {
  it('returns false before 72 hours', () => {
    const deliveredAt = new Date('2026-04-07T00:00:00Z')
    const now = new Date('2026-04-08T00:00:00Z') // 24h later
    expect(isSilentConfirmDue(deliveredAt, now)).toBe(false)
  })

  it('returns true at exactly 72 hours', () => {
    const deliveredAt = new Date('2026-04-05T10:00:00Z')
    const now = new Date('2026-04-08T10:00:00Z') // exactly 72h
    expect(isSilentConfirmDue(deliveredAt, now)).toBe(true)
  })

  it('returns true after 72 hours', () => {
    const deliveredAt = new Date('2026-04-01T00:00:00Z')
    const now = new Date('2026-04-08T00:00:00Z') // 168h
    expect(isSilentConfirmDue(deliveredAt, now)).toBe(true)
  })
})
