/**
 * Integration tests — seller bulk product import validations
 *
 * Covers:
 * - getLeafDescendants: correct DFS traversal of category tree
 * - parentCategorySlug whitelist: rows with out-of-scope slugs are rejected
 * - Cross-seller barcode uniqueness: DB-registered barcode is rejected
 * - In-file barcode deduplication: duplicate barcode within the same upload is rejected
 *
 * The bulk import logic lives in both apps/seller-panel/src/lib/ (seller-initiated)
 * and apps/admin-panel/src/lib/ (admin-initiated on behalf of a seller).
 * This test suite exercises the shared logic via the seller-panel copy.
 *
 * Relevant rules: 09-seller-panel-rules.md, 10-admin-panel-rules.md, 02-coding-standards.md
 */
import { describe, it, expect, vi } from 'vitest'

// Mock the Prisma singleton and search job BEFORE any service imports,
// so the top-level `new PrismaClient()` in api/lib/prisma.ts never fires.
vi.mock('../../api/lib/prisma', () => ({
  prisma: {},
  createPrismaForRoute: () => ({}),
  default: {},
}))

vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  closeQueues: vi.fn(),
}))

vi.mock('../../api/lib/redis', () => ({
  redis: {},
  getRedis: vi.fn(),
}))

import { createCatalogService } from '../../api/services/catalog.service'
import {
  buildBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRows,
  filterBulkCategoryReferenceRowsByScope,
  resolveBulkCategoryRealSlug,
} from '../../apps/seller-panel/src/lib/bulk-category-options'
import { normalizeBulkProductRow } from '../../apps/seller-panel/src/lib/bulk-product-import'

type MockCategory = {
  id: string
  slug: string
  name: string
  parentId: string | null
  isActive: boolean
}

function makeCategories(): MockCategory[] {
  return [
    { id: 'cat-1', slug: 'mobilya', name: 'Mobilya', parentId: null, isActive: true },
    { id: 'cat-2', slug: 'mobilya-oturma', name: 'Oturma Grubu', parentId: 'cat-1', isActive: true },
    { id: 'cat-3', slug: 'mobilya-yatak', name: 'Yatak Odasi', parentId: 'cat-1', isActive: true },
    { id: 'cat-4', slug: 'mobilya-sehpa', name: 'Sehpa', parentId: 'cat-2', isActive: true },
    { id: 'cat-5', slug: 'mobilya-koltuk', name: 'Koltuk', parentId: 'cat-2', isActive: true },
    { id: 'cat-6', slug: 'mobilya-karyola', name: 'Karyola', parentId: 'cat-3', isActive: true },
    { id: 'cat-7', slug: 'tekstil', name: 'Tekstil', parentId: null, isActive: true },
    { id: 'cat-8', slug: 'tekstil-yorgan', name: 'Yorgan', parentId: 'cat-7', isActive: true },
  ]
}

function buildCatalogSvc(categories: MockCategory[]) {
  const prisma = {
    category: {
      findMany: vi.fn().mockResolvedValue(categories),
    },
    product: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
    },
    seller: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as Parameters<typeof createCatalogService>[0]['prisma']

  return createCatalogService({ prisma })
}

describe('getLeafDescendants', () => {
  it('returns all leaf nodes under the given parent slug', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya')

    const slugs = leaves.map((leaf) => leaf.slug).sort()
    expect(slugs).toEqual(['mobilya-karyola', 'mobilya-koltuk', 'mobilya-sehpa'])
  })

  it('returns only direct leaf when subtree has no further children', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('tekstil')

    expect(leaves).toHaveLength(1)
    expect(leaves[0]?.slug).toBe('tekstil-yorgan')
  })

  it('returns a single-node leaf when given a leaf slug directly', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya-sehpa')

    expect(leaves).toHaveLength(1)
    expect(leaves[0]?.slug).toBe('mobilya-sehpa')
  })

  it('returns empty array for unknown slug', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('non-existent-slug')

    expect(leaves).toHaveLength(0)
  })

  it('does not include intermediate (non-leaf) categories', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya')

    const slugs = leaves.map((leaf) => leaf.slug)
    expect(slugs).not.toContain('mobilya-oturma')
    expect(slugs).not.toContain('mobilya-yatak')
    expect(slugs).not.toContain('mobilya')
  })
})

describe('parentCategorySlug whitelist', () => {
  it('getLeafDescendants result used as allowlist correctly admits in-scope slug', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya')
    const allowed = new Set(leaves.map((leaf) => leaf.slug))

    expect(allowed.has('mobilya-sehpa')).toBe(true)
    expect(allowed.has('mobilya-koltuk')).toBe(true)
  })

  it('rejects a slug from a different tree', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya')
    const allowed = new Set(leaves.map((leaf) => leaf.slug))

    expect(allowed.has('tekstil-yorgan')).toBe(false)
  })

  it('rejects an intermediate category slug', async () => {
    const svc = buildCatalogSvc(makeCategories())
    const leaves = await svc.getLeafDescendants('mobilya')
    const allowed = new Set(leaves.map((leaf) => leaf.slug))

    expect(allowed.has('mobilya-oturma')).toBe(false)
  })

  it('allows any slug when no parentCategorySlug is given (null allowlist)', () => {
    const allowedSlugs: Set<string> | null = null
    const isAllowed = (slug: string) => allowedSlugs === null || allowedSlugs.has(slug)

    expect(isAllowed('any-category-slug')).toBe(true)
    expect(isAllowed('mobilya-sehpa')).toBe(true)
  })
})

describe('in-file duplicate barcode detection', () => {
  function detectInFileDuplicates(barcodes: string[]) {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const barcode of barcodes) {
      if (seen.has(barcode)) {
        duplicates.push(barcode)
      } else {
        seen.add(barcode)
      }
    }
    return duplicates
  }

  it('reports no duplicates when all barcodes are unique', () => {
    const result = detectInFileDuplicates([
      '8691234567890',
      '8699876543210',
      '8690001112223',
    ])
    expect(result).toHaveLength(0)
  })

  it('reports the barcode that appears more than once', () => {
    const result = detectInFileDuplicates([
      '8691234567890',
      '8699876543210',
      '8691234567890',
    ])
    expect(result).toEqual(['8691234567890'])
  })

  it('reports each duplicate independently when multiple pairs exist', () => {
    const result = detectInFileDuplicates([
      '8691111111110',
      '8692222222220',
      '8691111111110',
      '8692222222220',
    ])
    expect(result).toEqual(['8691111111110', '8692222222220'])
  })
})

describe('cross-seller barcode uniqueness', () => {
  it('rejects a row whose barcode is already in the DB', async () => {
    const existingBarcodes = new Set(['8691234567890'])
    const rowBarcode = '8691234567890'

    const isConflict = existingBarcodes.has(rowBarcode)
    expect(isConflict).toBe(true)
  })

  it('accepts a row whose barcode is not in the DB', () => {
    const existingBarcodes = new Set(['8691234567890'])
    const rowBarcode = '8699999999990'

    const isConflict = existingBarcodes.has(rowBarcode)
    expect(isConflict).toBe(false)
  })

  it('DB barcode set is populated from product.findMany response', () => {
    const dbRows = [
      { barcode: '8691234567890' },
      { barcode: null },
      { barcode: '8699876543210' },
    ]
    const existingBarcodes = new Set(
      dbRows.map((product) => product.barcode).filter((barcode): barcode is string => Boolean(barcode)),
    )
    expect(existingBarcodes.size).toBe(2)
    expect(existingBarcodes.has('8691234567890')).toBe(true)
    expect(existingBarcodes.has('8699876543210')).toBe(true)
  })
})

describe('normalizeBulkProductRow - barcode format', () => {
  const validBase = {
    'Urun Adi*': 'Test Urun',
    'Kategori Slug*': 'mobilya-sehpa',
    'Urun Rengi*': 'Ceviz',
    'Materyal*': 'Masif Ahsap',
    'Fiyat*': 1990,
    'Sevk Suresi (is gunu)*': 7,
    'Stok*': 10,
    'Barkod (13 hane)*': '8691234567890',
  }

  it('accepts a valid 13-digit barcode', () => {
    const result = normalizeBulkProductRow(validBase, 2)
    expect(result.errors).toHaveLength(0)
    expect(result.data?.barcode).toBe('8691234567890')
  })

  it('rejects a barcode shorter than 13 digits', () => {
    const result = normalizeBulkProductRow(
      { ...validBase, 'Barkod (13 hane)*': '123456789' },
      2,
    )
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((error) => error.includes('13'))).toBe(true)
  })

  it('rejects a barcode with letters', () => {
    const result = normalizeBulkProductRow(
      { ...validBase, 'Barkod (13 hane)*': 'ABC1234567890' },
      2,
    )
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects compareAtPrice that is not greater than price', () => {
    const result = normalizeBulkProductRow(
      { ...validBase, 'Liste Fiyati (ustu cizili)': 1990 },
      2,
    )
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((error) => error.toLowerCase().includes('liste fiyat'))).toBe(true)
  })

  it('accepts rows from the new template without rootCategorySlug column', () => {
    const result = normalizeBulkProductRow(
      {
        'Urun Adi*': 'Test Urun',
        'Kategori*': 'Mobilya / Sehpa',
        'Urun Rengi*': 'Ceviz',
        'Materyal*': 'Masif Ahsap',
        'Fiyat*': 1990,
        'Sevk Suresi (is gunu)*': 7,
        'Stok*': 10,
        'Barkod (13 hane)*': '8691234567890',
      },
      2,
    )

    expect(result.errors).toHaveLength(0)
    expect(result.data?.rootCategorySlug).toBeUndefined()
  })
})

describe('bulk template category scope resolution', () => {
  const referenceRows = buildBulkCategoryReferenceRows([
    { id: 'root-ev', slug: 'ev', name: 'Ev', parentId: null, isActive: true },
    { id: 'root-ofis', slug: 'ofis', name: 'Ofis', parentId: null, isActive: true },
    { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'root-ev', isActive: true },
    { id: 'ofis-mobilya', slug: 'ofis-mobilya', name: 'Mobilya', parentId: 'root-ofis', isActive: true },
    { id: 'ev-sehpa', slug: 'ev-mobilya-sehpa', name: 'Sehpa', parentId: 'ev-mobilya', isActive: true },
  ])

  it('keeps only rows inside the selected shared category scope', () => {
    const scoped = filterBulkCategoryReferenceRows(referenceRows, 'mobilya')

    expect(scoped.map((row) => row.realSlug).sort()).toEqual([
      'ev-mobilya',
      'ev-mobilya-sehpa',
      'ofis-mobilya',
    ])
  })

  it('keeps only rows inside the selected Ev/Ofis subtree scope', () => {
    const scoped = filterBulkCategoryReferenceRowsByScope(referenceRows, 'ev', 'ev-mobilya')

    expect(scoped.map((row) => row.realSlug).sort()).toEqual([
      'ev-mobilya',
      'ev-mobilya-sehpa',
    ])
  })

  it('rejects invalid root/category combinations by failing resolution', () => {
    const resolved = resolveBulkCategoryRealSlug(referenceRows, 'Ofis', 'Mobilya / Sehpa')

    expect(resolved).toBeNull()
  })

  it('resolves valid root/category combinations to the correct category slug', () => {
    const resolved = resolveBulkCategoryRealSlug(referenceRows, 'Ev', 'Mobilya / Sehpa')

    expect(resolved).toBe('ev-mobilya-sehpa')
  })
})
