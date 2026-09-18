import { describe, expect, it } from 'vitest'
import {
  formatProductColors,
  formatProductDimensions,
  getProductColorLabels,
  getProductMaterialLabel,
} from '../../../api/domain/product-characteristics'

const attributeValues = [
  { sortOrder: 1, option: { type: 'color', label: 'Beyaz' } },
  { sortOrder: 0, option: { type: 'material', label: 'Meşe' } },
  { sortOrder: 0, option: { type: 'color', label: 'Siyah' } },
]

describe('getProductColorLabels', () => {
  it('orders Renk 1 (sortOrder 0) before Renk 2 (sortOrder 1) regardless of input order', () => {
    expect(getProductColorLabels(attributeValues)).toEqual(['Siyah', 'Beyaz'])
  })

  it('returns an empty list when there is no colour attribute or the input is missing', () => {
    expect(getProductColorLabels([{ sortOrder: 0, option: { type: 'material', label: 'Meşe' } }])).toEqual([])
    expect(getProductColorLabels(undefined)).toEqual([])
    expect(getProductColorLabels(null)).toEqual([])
  })

  it('drops blank labels', () => {
    expect(
      getProductColorLabels([
        { sortOrder: 0, option: { type: 'color', label: '  ' } },
        { sortOrder: 1, option: { type: 'color', label: 'Krem' } },
      ]),
    ).toEqual(['Krem'])
  })
})

describe('getProductMaterialLabel', () => {
  it('returns the material label when present', () => {
    expect(getProductMaterialLabel(attributeValues)).toBe('Meşe')
  })

  it('returns null when there is no material attribute', () => {
    expect(getProductMaterialLabel([{ sortOrder: 0, option: { type: 'color', label: 'Siyah' } }])).toBeNull()
    expect(getProductMaterialLabel(undefined)).toBeNull()
  })
})

describe('formatProductColors', () => {
  it('joins two colours with " - " as shown on the storefront', () => {
    expect(formatProductColors(['Siyah', 'Beyaz'])).toBe('Siyah - Beyaz')
  })

  it('keeps a single colour as-is and returns null for none', () => {
    expect(formatProductColors(['Mix'])).toBe('Mix')
    expect(formatProductColors([])).toBeNull()
  })
})

describe('formatProductDimensions', () => {
  it('formats En / Boy / Yükseklik in cm separated by middle dots', () => {
    expect(formatProductDimensions({ widthCm: 100, lengthCm: 30, heightCm: 45 })).toBe(
      'En: 100 cm · Boy: 30 cm · Yükseklik: 45 cm',
    )
  })

  it('prints only the dimensions that were entered', () => {
    expect(formatProductDimensions({ widthCm: 100, lengthCm: null, heightCm: 45 })).toBe(
      'En: 100 cm · Yükseklik: 45 cm',
    )
    expect(formatProductDimensions({ widthCm: null, lengthCm: 30.5, heightCm: null })).toBe('Boy: 30.5 cm')
  })

  it('returns null when no dimension was entered', () => {
    expect(formatProductDimensions({ widthCm: null, lengthCm: null, heightCm: null })).toBeNull()
  })
})
