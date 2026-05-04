import { describe, expect, it } from 'vitest'
import {
  normalizeImportBarcode,
  generateImportBarcode,
} from '../../api/services/product-import/barcode'

describe('normalizeImportBarcode', () => {
  it('13-digit barcode is returned unchanged', () => {
    expect(normalizeImportBarcode('1234567890123', 1)).toBe('1234567890123')
  })

  it('null input returns null', () => {
    expect(normalizeImportBarcode(null, 1)).toBeNull()
  })

  it('empty string returns null', () => {
    expect(normalizeImportBarcode('', 1)).toBeNull()
  })

  it('14+ digit input returns null (too long)', () => {
    expect(normalizeImportBarcode('12345678901234', 1)).toBeNull()
  })

  it('5-digit input padded to 13 digits with seller prefix', () => {
    const result = normalizeImportBarcode('12345', 120)
    expect(result).toHaveLength(13)
    expect(result).not.toBeNull()
  })

  it('non-numeric characters are stripped before processing', () => {
    const result = normalizeImportBarcode('12-34-5', 1)
    expect(result).toHaveLength(13)
  })
})

describe('generateImportBarcode', () => {
  const seed = 'seller-1:product-abc:product:Test'

  it('13-digit raw at attempt=0 returns it unchanged', () => {
    expect(
      generateImportBarcode({ raw: '1234567890123', sellerNumber: 1, seed, attempt: 0 }),
    ).toBe('1234567890123')
  })

  it('short raw at attempt=0 pads to 13 digits', () => {
    const result = generateImportBarcode({ raw: '12345', sellerNumber: 120, seed, attempt: 0 })
    expect(result).toHaveLength(13)
  })

  it('no raw at attempt=0 generates seller-prefixed barcode', () => {
    const result = generateImportBarcode({ raw: null, sellerNumber: 42, seed, attempt: 0 })
    expect(result).toHaveLength(13)
    expect(result.startsWith('42')).toBe(true)
  })

  it('attempt>0 always returns seller-prefixed barcode regardless of raw', () => {
    const withOverride = generateImportBarcode({
      raw: '9999999999999',
      sellerNumber: 42,
      seed,
      attempt: 1,
    })
    expect(withOverride).toHaveLength(13)
    expect(withOverride.startsWith('42')).toBe(true)
  })

  it('different attempts produce different barcodes', () => {
    const a0 = generateImportBarcode({ raw: null, sellerNumber: 1, seed, attempt: 0 })
    const a1 = generateImportBarcode({ raw: null, sellerNumber: 1, seed, attempt: 1 })
    const a2 = generateImportBarcode({ raw: null, sellerNumber: 1, seed, attempt: 2 })
    expect(a0).not.toBe(a1)
    expect(a1).not.toBe(a2)
  })

  it('same params always produce same barcode (deterministic)', () => {
    const r1 = generateImportBarcode({ raw: null, sellerNumber: 5, seed, attempt: 0 })
    const r2 = generateImportBarcode({ raw: null, sellerNumber: 5, seed, attempt: 0 })
    expect(r1).toBe(r2)
  })
})
