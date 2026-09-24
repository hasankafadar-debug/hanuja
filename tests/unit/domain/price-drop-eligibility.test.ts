import { describe, expect, it } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  effectiveTimeline,
  evaluatePriceDrop,
  pickPrimaryDrop,
  priceAt,
  PRICE_DROP_WINDOW_MS,
  windowMinimum,
  type TimelineRow,
} from '../../../api/domain/price-drop-eligibility'

const DAY = 24 * 60 * 60 * 1000
const T = new Date('2026-10-20T10:00:00.000Z')
let seq = 0n

function row(at: Date | number, price: number, extra: Partial<TimelineRow> = {}): TimelineRow {
  seq += 1n
  return { seq, recordedAt: at instanceof Date ? at : new Date(at), price: new Decimal(price), ...extra }
}

function daysBefore(days: number, base = T) {
  return new Date(base.getTime() - days * DAY)
}

function evaluate(rows: TimelineRow[], changeRow: TimelineRow, overrides: Partial<Parameters<typeof evaluatePriceDrop>[0]> = {}) {
  return evaluatePriceDrop({
    rows,
    changeRow,
    at: changeRow.recordedAt,
    now: changeRow.recordedAt,
    trackedSince: daysBefore(20),
    sellable: true,
    currentPrice: changeRow.price,
    ...overrides,
  })
}

describe('timeline helpers', () => {
  it('drops cancelled and future rows and keeps the highest seq at one instant (shadowing)', () => {
    const a = row(daysBefore(2), 100)
    const cancelled = row(daysBefore(1), 10, { cancelledAt: T })
    const early = row(T, 90)
    const late = row(T, 95) // same instant, higher seq → wins
    const future = row(new Date(T.getTime() + 1), 1)
    const timeline = effectiveTimeline([a, cancelled, early, late, future], T)
    expect(timeline.map((entry) => entry.price.toNumber())).toEqual([100, 95])
  })

  it('priceAt returns the price in effect at an instant', () => {
    const timeline = effectiveTimeline([row(daysBefore(5), 100), row(daysBefore(2), 80)], T)
    expect(priceAt(timeline, daysBefore(3))?.price.toNumber()).toBe(100)
    expect(priceAt(timeline, daysBefore(2))?.price.toNumber()).toBe(80)
    expect(priceAt(timeline, daysBefore(6))).toBeNull()
  })

  it('window minimum includes the price in effect when the window opens', () => {
    const timeline = effectiveTimeline([row(daysBefore(20), 70), row(daysBefore(10), 100)], T)
    // 70 was in effect at T − 15 days (it lasted until T − 10 days).
    expect(windowMinimum(timeline, T)?.toNumber()).toBe(70)
  })

  it('window minimum ignores prices that ended before the window opened', () => {
    const timeline = effectiveTimeline(
      [row(daysBefore(20), 70), row(daysBefore(16), 100), row(daysBefore(5), 120)],
      T,
    )
    expect(windowMinimum(timeline, T)?.toNumber()).toBe(100)
  })
})

describe('evaluatePriceDrop', () => {
  it('eligible when the new price is below every price of the last 15 days', () => {
    const rows = [row(daysBefore(20), 100), row(daysBefore(5), 110)]
    const change = row(T, 90)
    expect(evaluate([...rows, change], change)).toMatchObject({ eligible: true })
  })

  it('eligible when the new price equals the 15-day minimum (equal minimum)', () => {
    const rows = [row(daysBefore(20), 100), row(daysBefore(8), 80), row(daysBefore(4), 100)]
    const change = row(T, 80)
    const result = evaluate([...rows, change], change)
    expect(result).toMatchObject({ eligible: true })
    expect(result.eligible && result.windowMin.toNumber()).toBe(80)
  })

  it('not eligible when a lower price existed in the window', () => {
    const rows = [row(daysBefore(20), 100), row(daysBefore(8), 70), row(daysBefore(4), 100)]
    const change = row(T, 80)
    expect(evaluate([...rows, change], change)).toMatchObject({ eligible: false, reason: 'above_window_min' })
  })

  it('a lower price that ended just before the 15-day window does not block', () => {
    const rows = [row(daysBefore(30), 70), row(new Date(T.getTime() - PRICE_DROP_WINDOW_MS - 1), 100)]
    const change = row(T, 80)
    expect(evaluate([...rows, change], change)).toMatchObject({ eligible: true })
  })

  it('a price increase is not a drop', () => {
    const rows = [row(daysBefore(20), 100)]
    const change = row(T, 110)
    expect(evaluate([...rows, change], change)).toMatchObject({ eligible: false, reason: 'not_a_drop' })
  })

  it('history trusted exactly 15 days is enough; 1 ms less is not', () => {
    const rows = [row(daysBefore(20), 100)]
    const change = row(T, 90)
    const exact = new Date(T.getTime() - PRICE_DROP_WINDOW_MS)
    expect(evaluate([...rows, change], change, { trackedSince: exact })).toMatchObject({ eligible: true })
    expect(
      evaluate([...rows, change], change, { trackedSince: new Date(exact.getTime() + 1) }),
    ).toMatchObject({ eligible: false, reason: 'insufficient_history' })
    expect(evaluate([...rows, change], change, { trackedSince: null })).toMatchObject({
      eligible: false,
      reason: 'insufficient_history',
    })
  })

  it('not sellable (unpublished, seller away or out of stock) is not eligible', () => {
    const rows = [row(daysBefore(20), 100)]
    const change = row(T, 90)
    expect(evaluate([...rows, change], change, { sellable: false })).toMatchObject({
      eligible: false,
      reason: 'not_sellable',
    })
  })

  it('a price that changed since the drop is not announced', () => {
    const rows = [row(daysBefore(20), 100)]
    const change = row(T, 90)
    expect(evaluate([...rows, change], change, { currentPrice: new Decimal(95) })).toMatchObject({
      eligible: false,
      reason: 'price_changed',
    })
  })

  it('a drop older than 24 hours is stale', () => {
    const rows = [row(daysBefore(20), 100)]
    const change = row(T, 90)
    expect(
      evaluate([...rows, change], change, { now: new Date(T.getTime() + DAY + 1) }),
    ).toMatchObject({ eligible: false, reason: 'expired' })
  })

  it('a shadowed or cancelled change row produces no event', () => {
    const base = row(daysBefore(20), 100)
    const shadowed = row(T, 90)
    const winner = row(T, 95)
    expect(evaluate([base, shadowed, winner], shadowed)).toMatchObject({ eligible: false, reason: 'shadowed' })
    const cancelled = row(T, 80, { cancelledAt: T })
    expect(evaluate([base, cancelled], cancelled)).toMatchObject({ eligible: false, reason: 'cancelled_row' })
  })

  it('a future row never lowers the minimum', () => {
    const rows = [row(daysBefore(20), 100), row(new Date(T.getTime() + DAY), 10)]
    const change = row(T, 90)
    expect(evaluate([...rows, change], change)).toMatchObject({ eligible: true })
  })

  it('at send time the window is re-measured: a price that went lower and came back is caught', () => {
    const base = row(daysBefore(20), 100)
    const change = row(T, 80)
    const lower = row(new Date(T.getTime() + 60_000), 70)
    const back = row(new Date(T.getTime() + 120_000), 80)
    const sendAt = new Date(T.getTime() + 180_000)
    const result = evaluatePriceDrop({
      rows: [base, change, lower, back],
      changeRow: change,
      at: sendAt,
      now: sendAt,
      trackedSince: daysBefore(20),
      sellable: true,
      currentPrice: new Decimal(80),
    })
    expect(result).toMatchObject({ eligible: false, reason: 'above_window_min' })
  })
})

describe('pickPrimaryDrop', () => {
  it('announces the lowest new price, then the lowest key', () => {
    const drops = [
      { id: 'a', priceKey: 'variant:b', newPrice: new Decimal(80) },
      { id: 'b', priceKey: 'variant:a', newPrice: new Decimal(80) },
      { id: 'c', priceKey: 'variant:c', newPrice: new Decimal(90) },
    ]
    expect(pickPrimaryDrop(drops)?.id).toBe('b')
  })
})
