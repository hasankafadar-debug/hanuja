import { describe, expect, it } from 'vitest'
import {
  BULK_UPDATE_TEMPLATE_HEADERS,
  MAX_BULK_UPDATE_ROWS,
  normalizeBulkProductUpdateRow,
} from '@/lib/bulk-product-update'

describe('bulk product update row validator', () => {
  it('normalizes a valid row with Turkish headers', () => {
    const result = normalizeBulkProductUpdateRow(
      {
        'Barkod*': '8691234567890',
        'Yeni Fiyat': '4290',
        'Yeni Stok': '12',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data).toEqual({
      identifier: '8691234567890',
      newPrice: 4290,
      newStock: 12,
    })
  })

  it('requires at least one update field', () => {
    const result = normalizeBulkProductUpdateRow(
      {
        'Barkod*': '8691234567890',
        'Yeni Fiyat': '',
        'Yeni Stok': '',
      },
      3,
    )

    expect(result.data).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects sku-like identifiers because bulk update is barcode-only', () => {
    const result = normalizeBulkProductUpdateRow(
      {
        'Barkod*': 'SKU-01',
        'Yeni Fiyat': '4290',
      },
      4,
    )

    expect(result.data).toBeUndefined()
    expect(result.errors).toContain('Barkod 13 haneli rakam olmali')
  })

  it('keeps update upload limit capped at 500 rows', () => {
    expect(MAX_BULK_UPDATE_ROWS).toBe(500)
  })

  it('uses barcode-only template headers', () => {
    expect(BULK_UPDATE_TEMPLATE_HEADERS).toEqual(['Barkod*', 'Yeni Fiyat', 'Yeni Stok'])
  })
})
