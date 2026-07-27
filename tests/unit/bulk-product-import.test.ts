import { describe, expect, it } from 'vitest'
import {
  buildBulkCategoryReferenceRows,
  buildBulkTemplateAreas,
  resolveBulkCategoryRealSlug,
} from '@/lib/bulk-category-options'
import {
  BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG,
  BULK_PRODUCT_TEMPLATE_HEADERS,
  MAX_BULK_IMPORT_ROWS,
  buildBulkProductGroupKey,
  getMissingBulkProductHeaders,
  normalizeBulkProductRow,
  serializeBulkProductImportRowsForApi,
} from '@/lib/bulk-product-import'
import { sortAttributeOptions } from '@/lib/attribute-option-sort'
import { createBulkValidationError } from '@/lib/bulk-validation-error'
import {
  BULK_IMPORT_TRANSACTION_MAX_WAIT_MS,
  BULK_IMPORT_TRANSACTION_TIMEOUT_MS,
} from '@/lib/bulk-import-transaction'

describe('bulk product import row validator', () => {
  it('keeps validate and commit row errors in the stable API shape', () => {
    expect(createBulkValidationError(7, 'barcode', 'barcode_in_use', 'Kullanımda')).toEqual({
      rowNumber: 7,
      field: 'barcode',
      code: 'barcode_in_use',
      message: 'Kullanımda',
    })
  })

  it('allows a 500-row all-or-nothing import enough bounded transaction time', () => {
    expect(BULK_IMPORT_TRANSACTION_MAX_WAIT_MS).toBe(10_000)
    expect(BULK_IMPORT_TRANSACTION_TIMEOUT_MS).toBe(120_000)
  })

  it('normalizes a valid row with barcode and image urls', () => {
    const result = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        name: 'Masif Mese Sehpa',
        'Ana Kategori*': 'Ev',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
    expect(result.data?.categorySlug).toBe('Mobilya / Sehpa Modelleri / Orta Sehpa')
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
        'Model Kodu*': '',
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
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
        'Model Kodu*': 'SEHPA-001',
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
        'Model Kodu*': 'SEHPA-001',
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

    expect(missing).toContain('Model Kodu*')
    expect(missing).toContain('Fiyat*')
    expect(missing).toContain('Stok*')
    // Barcode is optional: a blank cell is auto-generated at commit time.
    expect(missing).not.toContain('Barkod (13 hane)')
    expect(missing).not.toContain('Barkod (13 hane)*')
    // Renk 2 is optional — never required.
    expect(missing).not.toContain('Renk 2')
    expect(missing).not.toContain('Renk 1')
    expect(missing).not.toContain('Materyal')
  })

  it('accepts the legacy "Urun Rengi*" header for the renamed Renk 1 column', () => {
    // Old downloaded templates still carry "Urun Rengi*"; it must satisfy the
    // Renk 1 requirement so those files keep importing.
    const missing = getMissingBulkProductHeaders([
      'Model Kodu*',
      'Urun Adi*',
      'Kategori*',
      'Urun Rengi*',
      'Materyal*',
      'Fiyat*',
      'Sevk Suresi (is gunu)*',
      'Stok*',
    ])

    expect(missing).toHaveLength(0)
  })

  it('accepts the new "Renk 1*" header for the color requirement', () => {
    const missing = getMissingBulkProductHeaders([
      'Model Kodu*',
      'Urun Adi*',
      'Kategori*',
      'Renk 1*',
      'Materyal*',
      'Fiyat*',
      'Sevk Suresi (is gunu)*',
      'Stok*',
    ])

    expect(missing).toHaveLength(0)
  })

  it('parses optional Renk 2 and dimension columns', () => {
    const result = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Iki Renkli Sehpa',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
        'Renk 1*': 'Siyah',
        'Renk 2': 'Beyaz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1890',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '6',
        'En (cm)': '100',
        'Boy (cm)': '30',
        'Yukseklik (cm)': '45',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.productColor).toBe('Siyah')
    expect(result.data?.secondColor).toBe('Beyaz')
    expect(result.data?.dimensionWidth).toBe(100)
    expect(result.data?.dimensionLength).toBe(30)
    expect(result.data?.dimensionHeight).toBe(45)
  })

  it('leaves Renk 2 and dimensions undefined when the columns are blank', () => {
    const result = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Tek Renkli Sehpa',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
        'Renk 1*': 'Ceviz',
        'Renk 2': '',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'En (cm)': '',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.secondColor).toBeUndefined()
    expect(result.data?.dimensionWidth).toBeUndefined()
    expect(result.data?.dimensionLength).toBeUndefined()
    expect(result.data?.dimensionHeight).toBeUndefined()
  })

  it('accepts a row with a blank barcode (auto-generated at commit)', () => {
    const result = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)': '',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.barcode).toBe('')
  })

  it('keeps upload limit capped at 500 rows', () => {
    expect(MAX_BULK_IMPORT_ROWS).toBe(500)
  })

  it('removes Ana Kategori from the new template headers', () => {
    expect(BULK_PRODUCT_TEMPLATE_HEADERS).not.toContain('Ana Kategori*')
  })

  it('exports Model Kodu and help text for every template column', () => {
    expect(BULK_PRODUCT_TEMPLATE_HEADERS).toContain('Model Kodu*')
    expect(BULK_PRODUCT_TEMPLATE_COLUMN_CONFIG.every((column) => 'helpText' in column && Boolean(column.helpText))).toBe(true)
  })

  it('keeps legacy Renk header mapped to variant color', () => {
    const result = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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

  it('preserves preview image URLs when serializing rows for server revalidation', () => {
    const parsed = normalizeBulkProductRow(
      {
        'Model Kodu*': 'SEHPA-001',
        'Urun Adi*': 'Ornek Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': '1200',
        'Sevk Suresi (is gunu)*': '7',
        'Stok*': '4',
        'Barkod (13 hane)*': '8691234567890',
        'Gorsel 1': 'https://media.hanuja.com.tr/products/a.jpg',
        'Gorsel 2': 'https://media.hanuja.com.tr/products/b.jpg',
      },
      2,
    )

    expect(parsed.data).toBeDefined()
    const [serialized] = serializeBulkProductImportRowsForApi([parsed.data!])
    expect(serialized).toMatchObject({
      image1: 'https://media.hanuja.com.tr/products/a.jpg',
      image2: 'https://media.hanuja.com.tr/products/b.jpg',
    })
    expect(serialized).not.toHaveProperty('imageUrls')

    const revalidated = normalizeBulkProductRow(serialized, 2)
    expect(revalidated.data?.imageUrls).toEqual([
      'https://media.hanuja.com.tr/products/a.jpg',
      'https://media.hanuja.com.tr/products/b.jpg',
    ])
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

  it('honors the curated sortOrder over alphabetical label order', () => {
    // Alphabetical (tr) would be Altın, Antrasit, Beyaz — curated sortOrder flips it.
    const sorted = sortAttributeOptions([
      { type: 'color', label: 'Altın', sortOrder: 30 },
      { type: 'color', label: 'Antrasit', sortOrder: 7 },
      { type: 'color', label: 'Beyaz', sortOrder: 0 },
    ]).map((option) => option.label)

    expect(sorted).toEqual(['Beyaz', 'Antrasit', 'Altın'])
  })

  it('keeps metallic finish families adjacent via sortOrder', () => {
    const sorted = sortAttributeOptions([
      { type: 'color', label: 'Rose Altın', sortOrder: 32 },
      { type: 'color', label: 'Altın', sortOrder: 30 },
      { type: 'color', label: 'Eskitme Altın', sortOrder: 31 },
      { type: 'color', label: 'Mix', sortOrder: 37 },
    ]).map((option) => option.label)

    expect(sorted).toEqual(['Altın', 'Eskitme Altın', 'Rose Altın', 'Mix'])
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
  it('accepts the legacy product group code as the required Model Kodu', () => {
    const row = normalizeBulkProductRow(
      {
        'Urun Grup Kodu': 'TAKIM-01',
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
    expect(buildBulkProductGroupKey(row.data!)).toContain('MODEL:'.toLowerCase())
  })

  it('does not use SKU to form product family groups', () => {
    const row = normalizeBulkProductRow(
      {
        'Model Kodu*': 'MODEL-01',
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
    expect(buildBulkProductGroupKey(row.data!)).toContain('MODEL-01')
  })

  it('uses normalized model code and category for product family groups', () => {
    const first = normalizeBulkProductRow(
      {
        'Model Kodu*': 'model  01',
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
        'Model Kodu*': 'MODEL 01',
        'Urun Adi*': 'Ayni Isimli Urun',
        'Kategori*': 'Mobilya / Sehpa Modelleri / Orta Sehpa',
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
    expect(buildBulkProductGroupKey(first.data!)).toBe(buildBulkProductGroupKey(second.data!))
  })
})
