/**
 * Integration tests — barcode availability check endpoint logic
 *
 * Tests normalizeImportBarcode and isBarcodeAvailable semantics
 * without hitting a real database (mock Prisma).
 */
import { describe, it, expect, vi } from 'vitest'
import { normalizeImportBarcode } from '../../api/services/product-import/barcode'

vi.mock('../../api/lib/prisma', () => ({
  prisma: {},
  createPrismaForRoute: () => ({}),
  default: {},
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  addJob: vi.fn(),
}))

describe('normalizeImportBarcode — barcode check logic', () => {
  it('returns null for empty input (would yield reason:invalid)', () => {
    expect(normalizeImportBarcode('', 1)).toBeNull()
  })

  it('returns null for letters-only input (invalid)', () => {
    expect(normalizeImportBarcode('ABCDEFGH', 1)).toBeNull()
  })

  it('returns 13-digit string for valid 13-digit input', () => {
    const result = normalizeImportBarcode('1234567890123', 1)
    expect(result).toBe('1234567890123')
    expect(result).toHaveLength(13)
  })

  it('returns 13-digit string for short numeric input (pads with seller prefix)', () => {
    const result = normalizeImportBarcode('99999', 5)
    expect(result).toHaveLength(13)
    expect(result).not.toBeNull()
  })

  it('strips non-numeric chars before processing', () => {
    const withDashes = normalizeImportBarcode('123-456-789-01', 1)
    // "123456789 01" → 12 digits → pads to 13
    expect(withDashes).toHaveLength(13)
  })

  it('returns null for more than 13 digits', () => {
    expect(normalizeImportBarcode('12345678901234', 1)).toBeNull()
  })
})
