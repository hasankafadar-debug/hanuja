import { describe, it, expect } from 'vitest'
import {
  buildProductStructuredData,
  selectProductSchemaImageUrl,
} from '../../packages/seo/src/structured-data/product'
import { buildOrganizationStructuredData } from '../../packages/seo/src/structured-data/organization'
import { calculateShippingFee } from '../../api/domain/shipping'
import { readPlatformShippingSettings } from '../../api/services/platform-settings.service'
import {
  normalizeBulkProductRow,
  getMissingBulkProductHeaders,
} from '../../apps/seller-panel/src/lib/bulk-product-import'

const input = {
  name: 'Mosaiss Antico',
  description: 'Sehpa',
  slug: 'antico',
  price: 1500,
  imageUrl: 'https://media.hanuja.tr/products/a.webp',
  brand: 'Mosaiss',
}
describe('merchant listing source contracts', () => {
  it('uses a real public image, actual brand and Hanuja seller without invented identifiers or ratings', () => {
    const data = buildProductStructuredData({ ...input, shippingRateTry: 0 }) as any
    expect(data.image).toBe(input.imageUrl)
    expect(data.brand.name).toBe('Mosaiss')
    expect(data.offers.seller.name).toBe('Hanuja')
    expect(data.offers.shippingDetails.shippingRate).toEqual({
      '@type': 'MonetaryAmount',
      value: 0,
      currency: 'TRY',
    })
    expect(data).not.toHaveProperty('gtin')
    expect(data).not.toHaveProperty('aggregateRating')
    expect(
      (
        buildProductStructuredData({
          ...input,
          aggregateRating: { ratingValue: 4.5, reviewCount: 2 },
        }) as any
      ).aggregateRating.reviewCount,
    ).toBe(2)
  })
  it('separates product handling from the confirmed domestic transit estimate', () => {
    const data = buildProductStructuredData({ ...input, shippingRateTry: 0,
      shippingDeliveryTime: { handlingDays: 20, transitMinDays: 2, transitMaxDays: 5 },
    }) as any
    expect(data.offers.shippingDetails.deliveryTime).toMatchObject({
      '@type': 'ShippingDeliveryTime',
      handlingTime: { minValue: 0, maxValue: 20, unitCode: 'DAY' },
      transitTime: { minValue: 2, maxValue: 5, unitCode: 'DAY' },
    })
    expect(data.offers.shippingDetails.deliveryTime.businessDays.dayOfWeek).toHaveLength(5)
    expect(data.offers.shippingDetails.deliveryTime.businessDays.dayOfWeek).not.toContain(
      'https://schema.org/Saturday',
    )
  })
  it.each([
    { handlingDays: -1, transitMinDays: 2, transitMaxDays: 5 },
    { handlingDays: 20, transitMinDays: 6, transitMaxDays: 5 },
    { handlingDays: 20, transitMinDays: 2.5, transitMaxDays: 5 },
    { handlingDays: Infinity, transitMinDays: 2, transitMaxDays: 5 },
  ])('omits invalid delivery estimates instead of publishing misleading ranges: %j', (shippingDeliveryTime) => {
    const data = buildProductStructuredData({ ...input, shippingRateTry: 0, shippingDeliveryTime }) as any
    expect(data.offers.shippingDetails).not.toHaveProperty('deliveryTime')
  })
  it('selects the first crawlable gallery asset and refuses empty/private/non-http sources', () => {
    expect(
      selectProductSchemaImageUrl([
        '',
        '/api/media/fetch?src=x',
        'data:image/png,x',
        input.imageUrl,
      ]),
    ).toBe(input.imageUrl)
    expect(selectProductSchemaImageUrl([])).toBeUndefined()
    expect(selectProductSchemaImageUrl(['/products/a.webp'])).toBe(
      'https://www.hanuja.com.tr/products/a.webp',
    )
  })
  it('uses current checkout thresholds, including the exact boundary', () => {
    const settings = { freeShippingThresholdTry: 2500, flatShippingFeeTry: 125 }
    expect([2499.99, 2500, 2500.01].map((price) => calculateShippingFee(price, settings))).toEqual([
      125, 0, 0,
    ])
  })
  it('reads shipping settings without creating configuration', async () => {
    const { vi } = await import('vitest')
    const findUnique = vi
      .fn()
      .mockResolvedValue({ freeShippingThresholdTry: 2500, flatShippingFeeTry: 125 })
    expect(
      await readPlatformShippingSettings({ platformSettings: { findUnique } } as never),
    ).toMatchObject({ flatShippingFeeTry: 125 })
    expect(findUnique).toHaveBeenCalledOnce()
  })
  it('links the published return policy to the same organization', () => {
    const data = buildOrganizationStructuredData({
      merchantReturnLink: 'https://www.hanuja.com.tr/iade-iptal',
    }) as any
    expect(data['@id']).toBe('https://www.hanuja.com.tr/#organization')
    expect(data.hasMerchantReturnPolicy.merchantReturnLink).toBe(
      'https://www.hanuja.com.tr/iade-iptal',
    )
    const product = buildProductStructuredData(input) as any
    expect(product.offers.hasMerchantReturnPolicy).toEqual({
      '@id': data.hasMerchantReturnPolicy['@id'],
    })
  })
  it('rejects missing brands in both old spreadsheets and individual rows', () => {
    expect(
      getMissingBulkProductHeaders(['Model Kodu*', 'Ürün Adı*', 'Kategori*', 'Fiyat*', 'Stok*']),
    ).toContain('Marka*')
    const row = {
      modelCode: 'A',
      name: 'Antico',
      categorySlug: 'sehpa',
      price: 2000,
      fulfillmentDays: 7,
      stockQuantity: 3,
    }
    expect(normalizeBulkProductRow(row, 2).errors.join(' ')).toMatch(/Marka/)
    const parsed = normalizeBulkProductRow({ ...row, brand: 'Mosaiss' }, 2)
    expect(parsed.errors).toEqual([])
    expect(parsed.data?.name).toBe('Mosaiss Antico')
    expect(parsed.data?.brand).toBe('Mosaiss')
  })
})
