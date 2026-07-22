import { describe, expect, it } from 'vitest'
import {
  buildBulkCategoryReferenceRows,
  buildBulkTemplateAreas,
  resolveBulkCategoryRealSlug,
} from '@/lib/bulk-category-options'
import {
  BULK_PRODUCT_TEMPLATE_HEADERS,
  MAX_BULK_IMPORT_ROWS,
  buildBulkProductGroupKey,
  getMissingBulkProductHeaders,
  normalizeBulkProductRow,
} from '@/lib/bulk-product-import'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'

describe('bulk product import row validator', () => {
  it('normalizes a valid row with barcode and image urls', () => {
    const result = normalizeBulkProductRow(
      {
        name: 'Masif Mese Sehpa',
        'Ana Kategori*': 'Ev',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        price: '1890',
        fulfillmentDays: '7',
        stockQuantity: '6',
        barcode: '8691234567890',
        SKU: 'SKU-01',
        shortDescription: 'Kisa aciklama',
        description: 'Uzun aciklama',
        story: 'Urun hikayesi',
        careInstructions: 'Bakim bilgisi',
        compareAtPrice: '2190',
        weight: '7.5',
        image1: 'https://media.hanuja.com.tr/products/a.jpg',
        image2: 'https://media.hanuja.com.tr/products/b.jpg',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.rootCategorySlug).toBe('ev')
    expect(result.data?.categorySlug).toBe('Mobilya / Sehpa Modelleri')
    expect(result.data?.productColor).toBe('Ceviz')
    expect(result.data?.productMaterial).toBe('Masif Ahsap')
    expect(result.data?.price).toBe(1890)
    expect(result.data?.compareAtPrice).toBe(2190)
    expect(result.data?.barcode).toBe('8691234567890')
    expect(result.data?.imageUrls).toEqual([
      'https://media.hanuja.com.tr/products/a.jpg',
      'https://media.hanuja.com.tr/products/b.jpg',
    ])
  })

  it('reports row validation errors for missing barcode and invalid values', () => {
    const result = normalizeBulkProductRow(
      {
        name: 'ab',
        'Ana Kategori*': '',
        'Kategori*': '',
        price: '-5',
        stockQuantity: '-1',
        barcode: '123',
      },
      4,
    )

    expect(result.data).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('accepts rows from the new template without Ana Kategori', () => {
    const result = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.rootCategorySlug).toBeUndefined()
  })

  it('continues to accept legacy rootCategorySlug values from old-format files', () => {
    const result = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ornek Urun',
        'Ana Kategori*': 'Ev',
        'Kategori*': 'Mobilya',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.rootCategorySlug).toBe('ev')
  })

  it('continues to accept legacy Kategori Slug headers', () => {
    const result = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ornek Urun',
        'Kategori Slug*': 'EV-MOBILYA',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.rootCategorySlug).toBeUndefined()
    expect(result.data?.categorySlug).toBe('ev-mobilya')
  })

  it('detects missing required template headers', () => {
    const missing = getMissingBulkProductHeaders(['Urun Adi*', 'Kategori Slug*'])

    expect(missing).toContain('Urun Rengi*')
    expect(missing).toContain('Materyal*')
    expect(missing).toContain('Fiyat*')
    expect(missing).toContain('Stok*')
    expect(missing).toContain('Barkod (13 hane)*')
  })

  it('keeps upload limit capped at 500 rows', () => {
    expect(MAX_BULK_IMPORT_ROWS).toBe(500)
  })

  it('removes Ana Kategori from the new template headers', () => {
    expect(BULK_PRODUCT_TEMPLATE_HEADERS).not.toContain('Ana Kategori*')
  })

  it('keeps legacy Renk header mapped to variant color', () => {
    const result = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
        Renk: 'Siyah',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.productColor).toBe('Ceviz')
    expect(result.data?.variantColor).toBe('Siyah')
  })
})

describe('attribute option sorting', () => {
  it('groups color tones after the base color', () => {
    const sorted = sortAttributeOptions([
      { type: 'color', label: 'Açık Kırmızı' },
      { type: 'color', label: 'Mavi' },
      { type: 'color', label: 'Kırmızı' },
      { type: 'color', label: 'Koyu Kırmızı' },
    ]).map((option) => option.label)

    expect(sorted).toEqual(['Kırmızı', 'Açık Kırmızı', 'Koyu Kırmızı', 'Mavi'])
  })
})

describe('bulk category resolution', () => {
  const referenceRows = buildBulkCategoryReferenceRows([
    { id: 'root-ev', slug: 'ev', name: 'Ev', parentId: null, isActive: true },
    { id: 'root-ofis', slug: 'ofis', name: 'Ofis', parentId: null, isActive: true },
    { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'root-ev', isActive: true },
    { id: 'ofis-mobilya', slug: 'ofis-mobilya', name: 'Mobilya', parentId: 'root-ofis', isActive: true },
  ])

  it('resolves Ev and Ofis for the same visible category to different real slugs', () => {
    expect(resolveBulkCategoryRealSlug(referenceRows, 'Ev', 'Mobilya')).toBe('ev-mobilya')
    expect(resolveBulkCategoryRealSlug(referenceRows, 'Ofis', 'Mobilya')).toBe('ofis-mobilya')
  })
})

describe('bulk template areas', () => {
  it('builds Ev and Ofis category groups for the two-step selector', () => {
    const areas = buildBulkTemplateAreas([
      { id: 'root-ev', slug: 'ev', name: 'Ev', parentId: null, isActive: true },
      { id: 'root-ofis', slug: 'ofis', name: 'Ofis', parentId: null, isActive: true },
      { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'root-ev', isActive: true },
      { id: 'ev-sehpa', slug: 'ev-mobilya-sehpa', name: 'Sehpa', parentId: 'ev-mobilya', isActive: true },
      { id: 'ofis-mobilya', slug: 'ofis-mobilya', name: 'Mobilya', parentId: 'root-ofis', isActive: true },
    ])

    expect(areas.map((area) => area.slug)).toEqual(['ev', 'ofis'])
    // Only leaf categories are offered: products may not be attached to an
    // intermediate category, so `ev-mobilya` (parent of `ev-mobilya-sehpa`)
    // must not appear in the template.
    expect(areas[0]?.categories.map((category) => category.slug)).toEqual(['ev-mobilya-sehpa'])
    expect(areas[1]?.categories.map((category) => category.slug)).toEqual(['ofis-mobilya'])
  })

  it('keeps intermediate categories in the cascading scope tree', () => {
    const areas = buildBulkTemplateAreas([
      { id: 'root-ev', slug: 'ev', name: 'Ev', parentId: null, isActive: true },
      { id: 'root-ofis', slug: 'ofis', name: 'Ofis', parentId: null, isActive: true },
      { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'root-ev', isActive: true },
      { id: 'ev-sehpa', slug: 'ev-mobilya-sehpa', name: 'Sehpa', parentId: 'ev-mobilya', isActive: true },
      { id: 'ofis-mobilya', slug: 'ofis-mobilya', name: 'Mobilya', parentId: 'root-ofis', isActive: true },
    ])

    // Scope is not the product's category: scoping to `Mobilya` must stay
    // possible so one template can cover every furniture leaf.
    expect(areas[0]?.scopeNodes).toEqual([
      { id: 'ev-mobilya', name: 'Mobilya', parentId: null },
      { id: 'ev-mobilya-sehpa', name: 'Sehpa', parentId: 'ev-mobilya' },
    ])
    // Each area only exposes its own branch.
    expect(areas[1]?.scopeNodes).toEqual([
      { id: 'ofis-mobilya', name: 'Mobilya', parentId: null },
    ])
  })

  it('omits inactive categories from the scope tree', () => {
    const areas = buildBulkTemplateAreas([
      { id: 'root-ev', slug: 'ev', name: 'Ev', parentId: null, isActive: true },
      { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'root-ev', isActive: true },
      { id: 'ev-sehpa', slug: 'ev-mobilya-sehpa', name: 'Sehpa', parentId: 'ev-mobilya', isActive: true },
      { id: 'ev-eski', slug: 'ev-eski', name: 'Emekli Dal', parentId: 'root-ev', isActive: false },
    ])

    expect(areas[0]?.scopeNodes.map((node) => node.id)).toEqual([
      'ev-mobilya',
      'ev-mobilya-sehpa',
    ])
  })
})

describe('bulk product group key', () => {
  it('ignores product group code when SKU is missing', () => {
    const row = normalizeBulkProductRow(
      {
        'Urun Grup Kodu': 'TAKIM-01',
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
        Renk: 'Ceviz',
      },
      2,
    )

    expect(row.data).toBeDefined()
    expect(buildBulkProductGroupKey(row.data!).startsWith('fingerprint:')).toBe(true)
  })

  it('falls back to sku when product group code is missing', () => {
    const row = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
        SKU: 'SKU-01',
        Renk: 'Ceviz',
      },
      2,
    )

    expect(row.data).toBeDefined()
    expect(buildBulkProductGroupKey(row.data!)).toBe('sku:sku-01')
  })

  it('builds a stable fingerprint when neither group code nor sku exists', () => {
    const first = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
        Aciklama: 'Birinci urun',
        Renk: 'Ceviz',
      },
      2,
    )
    const second = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri',
        'Urun Rengi*': 'Siyah',
        'Materyal*': 'Metal',
        'Fiyat*': '1250',
        'Sevk Suresi (is gunu)*': '10',
        'Stok*': '7',
        'Barkod (13 hane)*': '8691234567891',
        Aciklama: 'Ikinci urun',
        Renk: 'Siyah',
      },
      3,
    )

    expect(first.data).toBeDefined()
    expect(second.data).toBeDefined()
    expect(buildBulkProductGroupKey(first.data!)).not.toBe(buildBulkProductGroupKey(second.data!))
  })
})
