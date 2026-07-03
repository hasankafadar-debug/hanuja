/**
 * Business-day arithmetic — Pzt-Cum minus Turkish official holidays.
 *
 * Used for the 20-day fulfillment commitment and daily late-shipment
 * penalty accrual so that weekends and national/religious holidays do
 * not count toward the seller's deadline.
 */
import { isBusinessDay } from './tr-holidays'

function startOfDay(date: Date): Date {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function addCalendarDays(date: Date, days: number): Date {
  const value = new Date(date)
  value.setDate(value.getDate() + days)
  return value
}

function subtractCalendarDays(date: Date, days: number): Date {
  return addCalendarDays(date, -days)
}

/**
 * Add `days` business days to `from`. The starting day is NOT counted —
 * the first business day after `from` counts as day 1. Useful for
 * deadline computation (e.g. payment_confirmed + 20 business days).
 */
export function addBusinessDays(from: Date, days: number): Date {
  if (days <= 0) return startOfDay(from)
  let current = startOfDay(from)
  let added = 0
  while (added < days) {
    current = addCalendarDays(current, 1)
    if (isBusinessDay(current)) {
      added += 1
    }
  }
  return current
}

export function subtractBusinessDays(from: Date, days: number): Date {
  if (days <= 0) return startOfDay(from)
  let current = startOfDay(from)
  let subtracted = 0
  while (subtracted < days) {
    current = subtractCalendarDays(current, 1)
    if (isBusinessDay(current)) {
      subtracted += 1
    }
  }
  return current
}

/**
 * Count business days strictly after `from` and up to and including `to`.
 * Returns 0 if `to` is on or before `from`.
 *
 * For penalty breach: pass the deadline as `from` and the current day
 * (or worker tick day) as `to` — the result is the number of overdue
 * business days accrued so far.
 */
export function countBusinessDaysBetween(from: Date, to: Date): number {
  const start = startOfDay(from)
  const end = startOfDay(to)
  if (end.getTime() <= start.getTime()) return 0

  let count = 0
  let cursor = addCalendarDays(start, 1)
  while (cursor.getTime() <= end.getTime()) {
    if (isBusinessDay(cursor)) count += 1
    cursor = addCalendarDays(cursor, 1)
  }
  return count
}
