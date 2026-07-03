/**
 * Turkish official holidays — used by business-day arithmetic in
 * fulfillment and penalty calculations.
 *
 * Coverage: 2026-2035 (10 years). Past 2035 we fall back to fixed
 * national holidays only; religious-holiday data must be refreshed
 * from the official Diyanet calendar before 2034 to avoid drift.
 */

// Fixed civil holidays — same date every year.
const FIXED_HOLIDAYS: Array<{ month: number; day: number; label: string }> = [
  { month: 1, day: 1, label: 'Yılbaşı' },
  { month: 4, day: 23, label: 'Ulusal Egemenlik ve Çocuk Bayramı' },
  { month: 5, day: 1, label: 'Emek ve Dayanışma Günü' },
  { month: 5, day: 19, label: 'Atatürk\'ü Anma, Gençlik ve Spor Bayramı' },
  { month: 7, day: 15, label: 'Demokrasi ve Milli Birlik Günü' },
  { month: 8, day: 30, label: 'Zafer Bayramı' },
  { month: 10, day: 29, label: 'Cumhuriyet Bayramı' },
]

// Religious holidays follow the Hijri calendar — dates shift ~11 days earlier
// each Gregorian year. These ranges are sourced from the Diyanet
// (Presidency of Religious Affairs) published calendar.
//
// Each entry is an inclusive ISO date range covering all official days of
// the holiday (Ramazan: 3 days, Kurban: 4 days).
const RELIGIOUS_HOLIDAY_DATES: Record<number, string[]> = {
  2026: [
    // Ramazan Bayramı (Eid al-Fitr) — 20-22 Mart 2026
    '2026-03-20', '2026-03-21', '2026-03-22',
    // Kurban Bayramı (Eid al-Adha) — 27-30 Mayıs 2026
    '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30',
  ],
  2027: [
    // Ramazan Bayramı — 10-12 Mart 2027
    '2027-03-10', '2027-03-11', '2027-03-12',
    // Kurban Bayramı — 17-20 Mayıs 2027
    '2027-05-17', '2027-05-18', '2027-05-19', '2027-05-20',
  ],
  2028: [
    // Ramazan Bayramı — 26-28 Şubat 2028
    '2028-02-26', '2028-02-27', '2028-02-28',
    // Kurban Bayramı — 5-8 Mayıs 2028
    '2028-05-05', '2028-05-06', '2028-05-07', '2028-05-08',
  ],
  2029: [
    // Ramazan Bayramı — 14-16 Şubat 2029
    '2029-02-14', '2029-02-15', '2029-02-16',
    // Kurban Bayramı — 24-27 Nisan 2029
    '2029-04-24', '2029-04-25', '2029-04-26', '2029-04-27',
  ],
  2030: [
    // Ramazan Bayramı — 4-6 Şubat 2030
    '2030-02-04', '2030-02-05', '2030-02-06',
    // Kurban Bayramı — 13-16 Nisan 2030
    '2030-04-13', '2030-04-14', '2030-04-15', '2030-04-16',
  ],
  2031: [
    // Ramazan Bayramı — 24-26 Ocak 2031
    '2031-01-24', '2031-01-25', '2031-01-26',
    // Kurban Bayramı — 2-5 Nisan 2031
    '2031-04-02', '2031-04-03', '2031-04-04', '2031-04-05',
  ],
  2032: [
    // Ramazan Bayramı — 13-15 Ocak 2032
    '2032-01-13', '2032-01-14', '2032-01-15',
    // Kurban Bayramı — 21-24 Mart 2032
    '2032-03-21', '2032-03-22', '2032-03-23', '2032-03-24',
  ],
  2033: [
    // Ramazan Bayramı — 2-4 Ocak 2033 ve 22-24 Aralık 2033 (iki kez düşer)
    '2033-01-02', '2033-01-03', '2033-01-04',
    '2033-12-22', '2033-12-23', '2033-12-24',
    // Kurban Bayramı — 11-14 Mart 2033
    '2033-03-11', '2033-03-12', '2033-03-13', '2033-03-14',
  ],
  2034: [
    // Ramazan Bayramı — 11-13 Aralık 2034
    '2034-12-11', '2034-12-12', '2034-12-13',
    // Kurban Bayramı — 28 Şubat - 3 Mart 2034
    '2034-02-28', '2034-03-01', '2034-03-02', '2034-03-03',
  ],
  2035: [
    // Ramazan Bayramı — 1-3 Aralık 2035
    '2035-12-01', '2035-12-02', '2035-12-03',
    // Kurban Bayramı — 18-21 Şubat 2035
    '2035-02-18', '2035-02-19', '2035-02-20', '2035-02-21',
  ],
}

function ymd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Returns all Turkish official holiday dates for the given Gregorian year. */
export function getTurkishHolidays(year: number): Date[] {
  const dates: Date[] = []
  for (const fixed of FIXED_HOLIDAYS) {
    dates.push(new Date(year, fixed.month - 1, fixed.day))
  }
  const religious = RELIGIOUS_HOLIDAY_DATES[year] ?? []
  for (const iso of religious) {
    const [y, m, d] = iso.split('-').map(Number)
    dates.push(new Date(y!, m! - 1, d!))
  }
  return dates
}

/** Returns true if the given calendar day is a Turkish official holiday. */
export function isHoliday(date: Date): boolean {
  const year = date.getFullYear()
  const key = ymd(date)

  // Fixed civil holidays — compare month/day
  for (const fixed of FIXED_HOLIDAYS) {
    if (date.getMonth() + 1 === fixed.month && date.getDate() === fixed.day) {
      return true
    }
  }

  // Religious holidays — exact date match
  const religious = RELIGIOUS_HOLIDAY_DATES[year]
  if (religious && religious.includes(key)) {
    return true
  }

  return false
}

/** Returns true if the date is Sunday or Saturday (TR work calendar). */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/** Pzt-Cum and not a holiday. */
export function isBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isHoliday(date)
}

/**
 * Warning helper: when computing deadlines for years beyond the religious
 * holiday table, log a warning so operations knows to refresh the calendar.
 */
export function hasReligiousHolidayCoverage(year: number): boolean {
  return year in RELIGIOUS_HOLIDAY_DATES
}
