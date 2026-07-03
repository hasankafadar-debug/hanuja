import { describe, it, expect } from 'vitest'
import { getTurkishHolidays, isHoliday, isWeekend, isBusinessDay } from '../../../api/domain/tr-holidays'

describe('Turkish official holidays', () => {
  describe('fixed civil holidays', () => {
    it('flags 1 Ocak (New Year) as a holiday', () => {
      expect(isHoliday(new Date(2026, 0, 1))).toBe(true)
    })

    it('flags 23 Nisan (Ulusal Egemenlik) as a holiday', () => {
      expect(isHoliday(new Date(2026, 3, 23))).toBe(true)
    })

    it('flags 1 Mayıs (Labor) as a holiday', () => {
      expect(isHoliday(new Date(2026, 4, 1))).toBe(true)
    })

    it('flags 19 Mayıs (Atatürk) as a holiday', () => {
      expect(isHoliday(new Date(2026, 4, 19))).toBe(true)
    })

    it('flags 15 Temmuz (Demokrasi) as a holiday', () => {
      expect(isHoliday(new Date(2026, 6, 15))).toBe(true)
    })

    it('flags 30 Ağustos (Zafer) as a holiday', () => {
      expect(isHoliday(new Date(2026, 7, 30))).toBe(true)
    })

    it('flags 29 Ekim (Cumhuriyet) as a holiday', () => {
      expect(isHoliday(new Date(2026, 9, 29))).toBe(true)
    })

    it('does not flag 24 Nisan (one day after Egemenlik) as a holiday', () => {
      expect(isHoliday(new Date(2026, 3, 24))).toBe(false)
    })
  })

  describe('religious holidays (2026 — Diyanet calendar)', () => {
    it('flags Ramazan Bayramı first day (20 Mart 2026)', () => {
      expect(isHoliday(new Date(2026, 2, 20))).toBe(true)
    })

    it('flags Ramazan Bayramı third day (22 Mart 2026)', () => {
      expect(isHoliday(new Date(2026, 2, 22))).toBe(true)
    })

    it('flags Kurban Bayramı first day (27 Mayıs 2026)', () => {
      expect(isHoliday(new Date(2026, 4, 27))).toBe(true)
    })

    it('flags Kurban Bayramı fourth day (30 Mayıs 2026)', () => {
      expect(isHoliday(new Date(2026, 4, 30))).toBe(true)
    })

    it('does not flag 31 Mayıs (after Kurban) as religious holiday', () => {
      // 31 Mayıs 2026 is a Sunday but not a religious holiday
      expect(isHoliday(new Date(2026, 4, 31))).toBe(false)
    })
  })

  describe('getTurkishHolidays', () => {
    it('returns all official holidays for 2026 (7 fixed + 3 Ramazan + 4 Kurban = 14)', () => {
      const dates = getTurkishHolidays(2026)
      expect(dates.length).toBe(14)
    })

    it('returns 7 fixed holidays for years without religious data', () => {
      const dates = getTurkishHolidays(2050)
      expect(dates.length).toBe(7) // only fixed
    })
  })

  describe('isWeekend', () => {
    it('flags Saturday as weekend', () => {
      expect(isWeekend(new Date(2026, 4, 16))).toBe(true) // 16 May 2026 is a Saturday
    })

    it('flags Sunday as weekend', () => {
      expect(isWeekend(new Date(2026, 4, 17))).toBe(true) // 17 May 2026 is a Sunday
    })

    it('does not flag Monday as weekend', () => {
      expect(isWeekend(new Date(2026, 4, 18))).toBe(false) // 18 May 2026 is a Monday
    })
  })

  describe('isBusinessDay', () => {
    it('flags a regular Monday as a business day', () => {
      expect(isBusinessDay(new Date(2026, 4, 18))).toBe(true) // Monday, not holiday
    })

    it('does not flag Saturday as a business day', () => {
      expect(isBusinessDay(new Date(2026, 4, 16))).toBe(false)
    })

    it('does not flag 19 Mayıs (national holiday on a Tuesday) as a business day', () => {
      // 19 May 2026 is a Tuesday but also Atatürk Day
      expect(isBusinessDay(new Date(2026, 4, 19))).toBe(false)
    })

    it('does not flag 30 Mayıs (Saturday AND religious holiday) as a business day', () => {
      expect(isBusinessDay(new Date(2026, 4, 30))).toBe(false)
    })
  })
})
