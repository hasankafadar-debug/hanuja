import { describe, it, expect } from 'vitest'
import { parsePropertyFilters } from '../../api/domain/property-filters'
describe('property filter input isolation', () => {
  it('never writes user-controlled values into Object.constructor', () => {
    const before = (Object as unknown as { values?: unknown }).values
    const filters = parsePropertyFilters(
      new URLSearchParams(
        'f.constructor=%5B%22M%22%5D&f.constructor=%5B%22L%22%5D&f.__proto__=evil',
      ),
    )
    expect(Object.getPrototypeOf(filters)).toBeNull()
    expect(filters.constructor).toEqual({ values: ['M', 'L'] })
    expect((Object as unknown as { values?: unknown }).values).toBe(before)
    expect(Object.prototype.hasOwnProperty.call(filters, '__proto__')).toBe(false)
  })
})
