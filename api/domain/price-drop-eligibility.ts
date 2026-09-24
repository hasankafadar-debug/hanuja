/**
 * Lowest-price-of-15-days eligibility (e-mail plan phase 6). Pure functions over one price key's
 * history timeline; the services load the rows and decide what to do with the result.
 *
 * Timeline rules (docs/07-operations/email-phase-6-report.md):
 * - Only valid rows count: not cancelled and `recordedAt ≤ t`. A future (not yet happened) row
 *   never takes part.
 * - Rows are ordered by (recordedAt, seq). At one instant only the row with the highest seq is
 *   the price; the others are shadowed and neither count toward the minimum nor produce events.
 * - The window minimum at t is the minimum of the price in effect at `t − 15 days` and every
 *   price that started inside `(t − 15 days, t)`.
 */
import { Decimal } from '@prisma/client/runtime/client'

export const PRICE_DROP_WINDOW_DAYS = 15
export const PRICE_DROP_WINDOW_MS = PRICE_DROP_WINDOW_DAYS * 24 * 60 * 60 * 1000
/** A drop not dispatched within this time is stale and is not announced any more. */
export const PRICE_DROP_EVENT_TTL_MS = 24 * 60 * 60 * 1000

export interface TimelineRow {
  seq: bigint
  recordedAt: Date
  price: Decimal
  cancelledAt?: Date | null
}

export type PriceDropIneligibleReason =
  | 'expired'
  | 'not_sellable'
  | 'insufficient_history'
  | 'price_changed'
  | 'above_window_min'
  | 'not_a_drop'
  | 'shadowed'
  | 'cancelled_row'

export type PriceDropEvaluation =
  | { eligible: true; windowMin: Decimal; previousPrice: Decimal }
  | {
      eligible: false
      reason: PriceDropIneligibleReason
      windowMin: Decimal | null
      previousPrice: Decimal | null
    }

/** Valid rows up to `at`, one row per instant (the highest seq), sorted by time. */
export function effectiveTimeline(rows: TimelineRow[], at: Date): TimelineRow[] {
  const byInstant = new Map<number, TimelineRow>()
  for (const row of rows) {
    if (row.cancelledAt) continue
    const time = row.recordedAt.getTime()
    if (time > at.getTime()) continue
    const current = byInstant.get(time)
    if (!current || row.seq > current.seq) byInstant.set(time, row)
  }
  return [...byInstant.values()].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
}

/** The price in effect at `at` (the last timeline row with recordedAt ≤ at). */
export function priceAt(timeline: TimelineRow[], at: Date): TimelineRow | null {
  let found: TimelineRow | null = null
  for (const row of timeline) {
    if (row.recordedAt.getTime() > at.getTime()) break
    found = row
  }
  return found
}

/**
 * Minimum price over `[t − window, t)`: the price in effect at the window start plus every
 * price that started inside the window. Null when the timeline has no row before t.
 */
export function windowMinimum(timeline: TimelineRow[], t: Date, windowMs = PRICE_DROP_WINDOW_MS): Decimal | null {
  const windowStart = new Date(t.getTime() - windowMs)
  let min: Decimal | null = priceAt(timeline, windowStart)?.price ?? null
  for (const row of timeline) {
    const time = row.recordedAt.getTime()
    if (time <= windowStart.getTime()) continue
    if (time >= t.getTime()) break
    if (min === null || row.price.lt(min)) min = row.price
  }
  return min
}

export interface PriceDropEvaluationInput {
  /** All rows of the key (cancelled and future ones may be included; they are filtered). */
  rows: TimelineRow[]
  /** The history row of the change being evaluated. */
  changeRow: TimelineRow
  /** Instant the claim is made for: the change time when evaluating, now when sending. */
  at: Date
  now: Date
  trackedSince: Date | null
  sellable: boolean
  /** The key's effective price computed from the current data. */
  currentPrice: Decimal
}

/**
 * Checks, in order: the change row is still the price at its instant, it is a drop, it is not
 * stale, the key is sellable, the history is trusted for the whole window, the price did not
 * change since, and the price is not above the window minimum. Equal to the minimum is eligible.
 */
export function evaluatePriceDrop(input: PriceDropEvaluationInput): PriceDropEvaluation {
  const { changeRow, at, now } = input
  const changeAt = changeRow.recordedAt
  const newPrice = changeRow.price

  if (changeRow.cancelledAt) return ineligible('cancelled_row', null, null)

  const atChange = effectiveTimeline(input.rows, changeAt)
  const winner = atChange[atChange.length - 1]
  if (!winner || winner.recordedAt.getTime() !== changeAt.getTime() || winner.seq !== changeRow.seq) {
    return ineligible('shadowed', null, null)
  }

  const previous = priceAt(atChange, new Date(changeAt.getTime() - 1))
  if (!previous || !newPrice.lt(previous.price)) {
    return ineligible('not_a_drop', null, previous?.price ?? null)
  }

  if (changeAt.getTime() < now.getTime() - PRICE_DROP_EVENT_TTL_MS) {
    return ineligible('expired', null, previous.price)
  }
  if (!input.sellable) return ineligible('not_sellable', null, previous.price)

  const windowStart = at.getTime() - PRICE_DROP_WINDOW_MS
  if (!input.trackedSince || input.trackedSince.getTime() > windowStart) {
    return ineligible('insufficient_history', null, previous.price)
  }

  if (!input.currentPrice.eq(newPrice)) return ineligible('price_changed', null, previous.price)

  const timeline = effectiveTimeline(input.rows, at)
  const windowMin = windowMinimum(timeline, at)
  if (windowMin === null) return ineligible('insufficient_history', null, previous.price)
  if (newPrice.gt(windowMin)) return ineligible('above_window_min', windowMin, previous.price)

  return { eligible: true, windowMin, previousPrice: previous.price }
}

function ineligible(
  reason: PriceDropIneligibleReason,
  windowMin: Decimal | null,
  previousPrice: Decimal | null,
): PriceDropEvaluation {
  return { eligible: false, reason, windowMin, previousPrice }
}

/**
 * Among the eligible drops of one product at one instant, the lowest new price (then the lowest
 * price key) is announced; the others are kept as `grouped` for audit only.
 */
export function pickPrimaryDrop<T extends { priceKey: string; newPrice: Decimal }>(drops: T[]): T | null {
  let best: T | null = null
  for (const drop of drops) {
    if (
      !best ||
      drop.newPrice.lt(best.newPrice) ||
      (drop.newPrice.eq(best.newPrice) && drop.priceKey < best.priceKey)
    ) {
      best = drop
    }
  }
  return best
}
