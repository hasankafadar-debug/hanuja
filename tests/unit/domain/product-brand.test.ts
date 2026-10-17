import { describe, it, expect, vi } from 'vitest'
vi.mock('../../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: vi.fn(),
  enqueueCategorySync: vi.fn(),
}))
import {
  formatBrandedProductName,
  requireProductBrand,
  stripProductBrandPrefix,
} from '../../../api/domain/product-brand'

describe('product brand identity', () => {
  it('requires a real brand and validates the complete title', () => {
    for (const value of [undefined, null, '', '   ', 'a'.repeat(121)])
      expect(() => requireProductBrand(value)).toThrow()
    expect(() => formatBrandedProductName('x'.repeat(195), 'Mosaiss')).toThrow('200')
  })
  it('preserves brand spelling, normalizes whitespace and adds exactly one prefix', () => {
    expect(formatBrandedProductName('  Antico   Orta Sehpa ', ' Mosaiss ')).toBe(
      'Mosaiss Antico Orta Sehpa',
    )
    expect(formatBrandedProductName('mosaiss MOSAİSS Antico', 'Mosaiss')).toBe('Mosaiss Antico')
    expect(formatBrandedProductName('İNCİ Ayna', 'İnci')).toBe('İnci Ayna')
    expect(formatBrandedProductName('Mosaissium Ayna', 'Mosaiss')).toBe('Mosaiss Mosaissium Ayna')
  })
  it('replaces an old brand and remains idempotent across saves and export', () => {
    const name = formatBrandedProductName('Mosaiss Antico Orta Sehpa', 'Alt Marka', 'Mosaiss')
    expect(name).toBe('Alt Marka Antico Orta Sehpa')
    expect(formatBrandedProductName('Mosaiss Home Antico', 'Mosaiss Home', 'Mosaiss')).toBe(
      'Mosaiss Home Antico',
    )
    expect(formatBrandedProductName('Mosaiss Home Antico', 'Mosaiss', 'Mosaiss Home')).toBe(
      'Mosaiss Antico',
    )
    expect(formatBrandedProductName('MOSAISS Antico', 'Mosaiss')).toBe('Mosaiss Antico')
    expect(formatBrandedProductName(name, 'Alt Marka')).toBe(name)
    expect(formatBrandedProductName(stripProductBrandPrefix(name, 'Alt Marka'), 'Alt Marka')).toBe(
      name,
    )
  })
})

import { createCatalogService } from '../../../api/services/catalog.service'
it('rejects invalid brand data at the service boundary before touching persistence', async () => {
  const service = createCatalogService({ prisma: {} as never })
  await expect(
    service.createProduct({
      name: 'Antico',
      brand: ' ',
      sellerId: 'seller',
      categoryId: 'cat',
      description: '',
      price: 1 as never,
      fulfillmentDays: 1,
      stockQuantity: 1,
      modelCode: 'A',
    }),
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
})
