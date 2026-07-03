import { describe, expect, it } from 'vitest'
import { formatOrderDisplayNumber, formatOrderNumber } from '../../api/lib/order-number'

describe('order number formatting', () => {
  it('returns the public number when present', () => {
    expect(formatOrderNumber(26000042, 'order-12345678')).toBe('26000042')
    expect(formatOrderDisplayNumber(26000042, 'order-12345678')).toBe('#26000042')
  })

  it('falls back to the raw id tail when public number is missing', () => {
    expect(formatOrderNumber(null, 'order-abcdef12')).toBe('ABCDEF12')
    expect(formatOrderDisplayNumber(undefined, 'order-abcdef12')).toBe('#ABCDEF12')
  })

  it('returns an empty string when both values are missing', () => {
    expect(formatOrderNumber(undefined, null)).toBe('')
    expect(formatOrderDisplayNumber(undefined, null)).toBe('#')
  })
})
