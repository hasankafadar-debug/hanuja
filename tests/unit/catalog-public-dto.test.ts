import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProductBySlug: vi.fn(),
  listPublished: vi.fn(),
}))

vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute: vi.fn(() => ({})) }))
vi.mock('../../api/services/catalog.service', () => ({
  createCatalogService: () => ({
    getProductBySlug: mocks.getProductBySlug,
    listPublished: mocks.listPublished,
  }),
}))

// Values that only exist in internal columns. None of them may reach the public JSON.
const INTERNAL_MARKERS = [
  'LEAK-SELLER-ID',
  'LEAK-USER-ID',
  'LEAK-COMMISSION',
  'LEAK-DOCUMENT-TYPE',
  'LEAK-SKU',
  'LEAK-MODEL-CODE',
  'LEAK-BARCODE',
  'LEAK-WEIGHT',
  'LEAK-REJECTION',
  'LEAK-FINDING',
  'LEAK-IMAGE-ID',
  'LEAK-PARENT-ID',
  'LEAK-TAX-RATE',
  'LEAK-TEMPLATE',
  'LEAK-VARIANT-SKU',
  'LEAK-VARIANT-BARCODE',
  'LEAK-VARIANT-PROPERTY',
  'LEAK-OPTION-ID',
]

const SUMMARY_KEYS = [
  'avgRating',
  'brand',
  'careInstructions',
  'categoryId',
  'compareAtPrice',
  'description',
  'dimensionHeight',
  'dimensionLength',
  'dimensionWidth',
  'fulfillmentDays',
  'id',
  'images',
  'name',
  'price',
  'properties',
  'reviewCount',
  'seller',
  'shortDescription',
  'slug',
  'stockQuantity',
  'story',
]
const DETAIL_KEYS = [...SUMMARY_KEYS, 'attributeValues', 'category', 'variants'].sort()

function sellerRow() {
  return {
    id: 'LEAK-SELLER-ID',
    userId: 'LEAK-USER-ID',
    slug: 'atolye-noa',
    displayName: 'Atölye Noa',
    sellerNumber: 4711,
    status: 'active',
    applicationSubmissionSeq: 3,
    vacationModeEnabled: false,
    commissionRateOverride: 'LEAK-COMMISSION',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    documentsRequestedAt: new Date('2026-01-03T00:00:00.000Z'),
    requiredDocumentTypes: ['LEAK-DOCUMENT-TYPE'],
    importEnabled: true,
    importRequestedAt: new Date('2026-01-04T00:00:00.000Z'),
  }
}

// Shape of catalog.service listPublished items: full product row + images + seller.
function listedProductRow() {
  return {
    id: 'product-1',
    sellerId: 'LEAK-SELLER-ID',
    categoryId: 'category-1',
    slug: 'mese-orta-sehpa',
    name: 'Meşe Orta Sehpa',
    brand: 'Atölye Noa',
    description: 'Masif meşe orta sehpa.',
    shortDescription: 'Masif meşe',
    story: 'Atölyede elde üretildi.',
    careInstructions: 'Kuru bezle silin.',
    status: 'published',
    price: 1350,
    compareAtPrice: 1500,
    fulfillmentDays: 12,
    stockQuantity: 4,
    sku: 'LEAK-SKU',
    modelCode: 'LEAK-MODEL-CODE',
    barcode: 'LEAK-BARCODE',
    weight: 'LEAK-WEIGHT',
    dimensionLength: 100,
    dimensionWidth: 60,
    dimensionHeight: 45,
    avgRating: 4.5,
    reviewCount: 8,
    createdAt: new Date('2026-02-01T00:00:00.000Z'),
    updatedAt: new Date('2026-02-02T00:00:00.000Z'),
    publishedAt: new Date('2026-02-03T00:00:00.000Z'),
    firstPublishedAt: new Date('2026-02-03T00:00:00.000Z'),
    properties: { malzeme: 'Meşe' },
    rejectedAt: new Date('2026-02-02T12:00:00.000Z'),
    rejectionReason: 'LEAK-REJECTION',
    moderationFindings: [{ term: 'LEAK-FINDING' }],
    images: [
      {
        id: 'LEAK-IMAGE-ID',
        productId: 'product-1',
        url: 'https://media.hanuja.tr/products/1.jpg',
        altText: 'Meşe orta sehpa',
        sortOrder: 0,
        isPrimary: true,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ],
    seller: sellerRow(),
  }
}

// Shape of catalog.service getProductBySlug: the listed shape plus category, variants and attributes.
function detailProductRow() {
  return {
    ...listedProductRow(),
    category: {
      id: 'category-1',
      slug: 'orta-sehpa',
      name: 'Orta Sehpa',
      description: 'Orta sehpa modelleri.',
      imageUrl: null,
      parentId: 'LEAK-PARENT-ID',
      sortOrder: 3,
      isActive: true,
      taxRate: 'LEAK-TAX-RATE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdViaImportBy: 'LEAK-SELLER-ID',
      createdViaImportAt: new Date('2026-01-01T00:00:00.000Z'),
      templateCode: 'LEAK-TEMPLATE',
      maxInstallmentCount: 6,
    },
    variants: [
      {
        id: 'variant-1',
        productId: 'product-1',
        name: 'Renk: Naturel',
        sku: 'LEAK-VARIANT-SKU',
        barcode: 'LEAK-VARIANT-BARCODE',
        price: 1215,
        compareAtPrice: 1350,
        stockQuantity: 2,
        options: { Renk: 'Naturel' },
        properties: { stok: 'LEAK-VARIANT-PROPERTY' },
        sortOrder: 0,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ],
    attributeValues: [
      {
        productId: 'product-1',
        optionId: 'LEAK-OPTION-ID',
        sortOrder: 0,
        option: {
          id: 'LEAK-OPTION-ID',
          type: 'color',
          label: 'Naturel',
          slug: 'naturel',
          hexColor: '#d8c3a5',
          isActive: true,
          sortOrder: 4,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    ],
  }
}

function expectNoInternalValues(body: unknown) {
  const json = JSON.stringify(body)
  for (const marker of INTERNAL_MARKERS) {
    expect(json).not.toContain(marker)
  }
}

function expectPublicSummary(item: Record<string, any>) {
  expect(Object.keys(item.seller).sort()).toEqual(['displayName', 'slug'])
  expect(Object.keys(item.images[0]).sort()).toEqual(['altText', 'isPrimary', 'sortOrder', 'url'])
  // The effective (discounted) price the service resolved passes through unchanged.
  expect(item.price).toBe(1350)
  expect(item.compareAtPrice).toBe(1500)
}

describe('public catalog DTO', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serializes only public storefront fields from the product listing', async () => {
    mocks.listPublished.mockResolvedValue([listedProductRow()])
    const routes = await import('../../api/routes/catalog')

    const res = await routes.listProducts(new Request('http://localhost/api/products') as never)
    const body = await res.json()
    const item = body.data[0]

    expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS)
    expectPublicSummary(item)
    expectNoInternalValues(body)
  })

  it('serializes only public storefront fields from the product detail', async () => {
    mocks.getProductBySlug.mockResolvedValue(detailProductRow())
    const routes = await import('../../api/routes/catalog')

    const res = await routes.getProductBySlug('mese-orta-sehpa')
    const body = await res.json()
    const detail = body.data

    expect(Object.keys(detail).sort()).toEqual(DETAIL_KEYS)
    expectPublicSummary(detail)
    expect(Object.keys(detail.category).sort()).toEqual(['id', 'name', 'slug'])
    expect(Object.keys(detail.variants[0]).sort()).toEqual([
      'compareAtPrice',
      'id',
      'name',
      'options',
      'price',
      'stockQuantity',
    ])
    expect(detail.variants[0].price).toBe(1215)
    expect(Object.keys(detail.attributeValues[0]).sort()).toEqual(['option', 'sortOrder'])
    expect(Object.keys(detail.attributeValues[0].option).sort()).toEqual([
      'hexColor',
      'label',
      'type',
    ])
    expectNoInternalValues(body)
  })
})
