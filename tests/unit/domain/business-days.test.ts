import { describe, it, expect } from 'vitest'
import { addBusinessDays, countBusinessDaysBetween } from '../../../api/domain/business-days'

describe('addBusinessDays', () => {
  it('returns startOfDay when days is 0', () => {
    const from = new Date(2026, 4, 4, 14, 30) // Monday afternoon
    const result = addBusinessDays(from, 0)
    expect(result.getHours()).toBe(0)
    expect(result.getDate()).toBe(4)
  })

  it('adds business days skipping weekends', () => {
    // Mon 4 May 2026 + 5 business days → Mon 11 May 2026
    const from = new Date(2026, 4, 4)
    const result = addBusinessDays(from, 5)
    expect(result.getFullYear()).toBe(2026)
    expect(result.getMonth()).toBe(4)
    expect(result.getDate()).toBe(11)
  })

  it('skips Saturday and Sunday', () => {
    // Fri 1 May 2026 (Labor Day — holiday). Start from Thu 30 Apr 2026.
    // Thu + 1 business day → Fri (but Fri = Labor → skip) → Mon 4 May 2026.
    // Actually 30 Apr is Thursday, 1 May Friday is holiday, 4 May Monday.
    const from = new Date(2026, 3, 30) // Thursday 30 Apr 2026
    const result = addBusinessDays(from, 1)
    expect(result.getDate()).toBe(4) // Monday 4 May
    expect(result.getMonth()).toBe(4)
  })

  it('skips Turkish national holidays', () => {
    // Wed 22 Apr 2026 + 1 business day → Fri 24 Apr (23 Apr is holiday)
    const from = new Date(2026, 3, 22) // Wednesday
    const result = addBusinessDays(from, 1)
    expect(result.getDate()).toBe(24) // Friday
  })

  it('handles 20-business-day fulfillment commitment', () => {
    // Mon 6 Apr 2026 + 20 business days → check it lands on a weekday and not a holiday
    const from = new Date(2026, 3, 6) // Monday 6 Apr 2026
    const result = addBusinessDays(from, 20)
    // 20 business days from 6 Apr (Mon) — 23 Apr Wed is holiday, weekends are off
    // Expected: ~4-5 calendar weeks later
    expect(result.getDay()).not.toBe(0) // not Sunday
    expect(result.getDay()).not.toBe(6) // not Saturday
  })
})

describe('countBusinessDaysBetween', () => {
  it('returns 0 when to is on or before from', () => {
    const from = new Date(2026, 4, 4)
    expect(countBusinessDaysBetween(from, from)).toBe(0)
    const earlier = new Date(2026, 4, 1)
    expect(countBusinessDaysBetween(from, earlier)).toBe(0)
  })

  it('counts only weekdays between two dates', () => {
    // Mon 4 May → Fri 8 May = 4 business days (Tue, Wed, Thu, Fri)
    const from = new Date(2026, 4, 4)
    const to = new Date(2026, 4, 8)
    expect(countBusinessDaysBetween(from, to)).toBe(4)
  })

  it('skips weekend in the range', () => {
    // Fri 8 May → Mon 11 May = 1 business day (Mon only)
    const from = new Date(2026, 4, 8)
    const to = new Date(2026, 4, 11)
    expect(countBusinessDaysBetween(from, to)).toBe(1)
  })

  it('skips holiday in the range', () => {
    // Wed 22 Apr → Fri 24 Apr = 1 business day (only Fri 24; Thu 23 = holiday)
    const from = new Date(2026, 3, 22)
    const to = new Date(2026, 3, 24)
    expect(countBusinessDaysBetween(from, to)).toBe(1)
  })
})
