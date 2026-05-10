/**
 * Unit tests — late-shipment daily accrual domain helpers.
 * Covers getLateShipmentBreachDayCount, getLateShipmentPenaltyRate,
 * calculateDailyLateShipmentPenalty.
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  calculateDailyLateShipmentPenalty,
  DAILY_LATE_SHIPMENT_PENALTY_RATE,
  getLateShipmentBreachDayCount,
  getLateShipmentPenaltyRate,
} from '../../api/domain/penalty-calculator'

function utcDate(iso: string) {
  return new Date(iso)
}

describe('getLateShipmentBreachDayCount', () => {
  it('returns 0 when asOf equals deadline', () => {
    const deadline = utcDate('2026-04-01T00:00:00Z')
    const asOf = utcDate('2026-04-01T00:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(0)
  })

  it('returns 0 when asOf precedes deadline', () => {
    const deadline = utcDate('2026-04-10T00:00:00Z')
    const asOf = utcDate('2026-04-05T00:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(0)
  })

  it('returns 1 day after deadline', () => {
    const deadline = utcDate('2026-04-01T00:00:00Z')
    const asOf = utcDate('2026-04-02T15:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(1)
  })

  it('returns 19 day breach (one-day-before auto-cancel)', () => {
    const deadline = utcDate('2026-04-01T00:00:00Z')
    const asOf = utcDate('2026-04-20T00:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(19)
  })

  it('returns 20 day breach (auto-cancel boundary)', () => {
    const deadline = utcDate('2026-04-01T00:00:00Z')
    const asOf = utcDate('2026-04-21T00:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(20)
  })

  it('returns 30 day breach when worker missed many runs', () => {
    const deadline = utcDate('2026-04-01T00:00:00Z')
    const asOf = utcDate('2026-05-01T00:00:00Z')
    expect(getLateShipmentBreachDayCount(deadline, asOf)).toBe(30)
  })
})

describe('calculateDailyLateShipmentPenalty', () => {
  it('returns 0 for non-positive day count', () => {
    const amount = new Decimal(1000)
    expect(calculateDailyLateShipmentPenalty(amount, 0).toNumber()).toBe(0)
    expect(calculateDailyLateShipmentPenalty(amount, -1).toNumber()).toBe(0)
  })

  it('1% of order amount on first overdue day', () => {
    const amount = new Decimal(1000)
    expect(calculateDailyLateShipmentPenalty(amount, 1).toNumber()).toBe(10)
  })

  it('19% of order amount on day 19', () => {
    const amount = new Decimal(1000)
    expect(calculateDailyLateShipmentPenalty(amount, 19).toNumber()).toBe(190)
  })

  it('20% of order amount on day 20 (matches rejection penalty rate cap)', () => {
    const amount = new Decimal(1000)
    expect(calculateDailyLateShipmentPenalty(amount, 20).toNumber()).toBe(200)
  })

  it('respects custom daily rate when provided', () => {
    const amount = new Decimal(500)
    const customRate = new Decimal('0.0050') // 0.5% per day
    expect(calculateDailyLateShipmentPenalty(amount, 10, customRate).toNumber()).toBe(25)
  })
})

describe('getLateShipmentPenaltyRate', () => {
  it('returns 0 for non-positive day count', () => {
    expect(getLateShipmentPenaltyRate(0).toNumber()).toBe(0)
  })

  it('returns 0.01 (1%) for day 1', () => {
    expect(getLateShipmentPenaltyRate(1).toNumber()).toBeCloseTo(0.01, 4)
  })

  it('returns 0.20 (20%) for day 20 — matches rejection penalty', () => {
    expect(getLateShipmentPenaltyRate(20).toNumber()).toBeCloseTo(0.2, 4)
  })

  it('uses DAILY_LATE_SHIPMENT_PENALTY_RATE constant by default (0.01)', () => {
    expect(DAILY_LATE_SHIPMENT_PENALTY_RATE.toNumber()).toBeCloseTo(0.01, 4)
  })
})
