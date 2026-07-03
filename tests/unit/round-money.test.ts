import { describe, expect, it } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney, formatMoney } from '../../packages/security/src/money'

describe('roundMoney', () => {
  it('truncates when third decimal is below 6 (boundary 0..5)', () => {
    expect(roundMoney(1.314).toString()).toBe('1.31')
    expect(roundMoney(1.315).toString()).toBe('1.31')
    expect(roundMoney(1.31499).toString()).toBe('1.31')
    expect(roundMoney(0.005).toString()).toBe('0')
  })

  it('rounds up when third decimal is 6 or higher', () => {
    expect(roundMoney(1.316).toString()).toBe('1.32')
    expect(roundMoney(1.319).toString()).toBe('1.32')
    expect(roundMoney(0.006).toString()).toBe('0.01')
  })

  it('handles 1.3175 by inspecting only the third decimal (7 >= 6 → up)', () => {
    expect(roundMoney(1.3175).toString()).toBe('1.32')
  })

  it('preserves sign for negative amounts using absolute-value rule', () => {
    expect(roundMoney(-1.315).toString()).toBe('-1.31')
    expect(roundMoney(-1.316).toString()).toBe('-1.32')
  })

  it('accepts Decimal and string inputs', () => {
    expect(roundMoney(new Decimal('1312.975')).toString()).toBe('1312.97')
    expect(roundMoney('1312.976').toString()).toBe('1312.98')
  })

  it('returns Decimal with two decimal places when value already short', () => {
    expect(roundMoney(10).toString()).toBe('10')
    expect(roundMoney('10.50').toString()).toBe('10.5')
  })
})

describe('formatMoney', () => {
  it('defaults to no-decimal TL suffix for UI surfaces', () => {
    expect(formatMoney(1250)).toBe('1.250 TL')
    expect(formatMoney(1312.4)).toBe('1.312 TL')
    expect(formatMoney(1312.975)).toBe('1.313 TL')
    expect(formatMoney(0)).toBe('0 TL')
  })

  it('keeps tr-TR thousands separator', () => {
    expect(formatMoney(1_250_000)).toBe('1.250.000 TL')
  })

  it('supports negative amounts', () => {
    expect(formatMoney(-1250)).toBe('-1.250 TL')
  })

  it('opts into kuruş precision via withKurus', () => {
    expect(formatMoney(1312.975, { withKurus: true })).toBe('1.312,97 TL')
    expect(formatMoney(1312.976, { withKurus: true })).toBe('1.312,98 TL')
  })

  it('drops the suffix when explicitly set to null', () => {
    expect(formatMoney(1250, { suffix: null })).toBe('1.250')
    expect(formatMoney(1312.97, { withKurus: true, suffix: null })).toBe('1.312,97')
  })
})
