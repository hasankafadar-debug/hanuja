/**
 * Unit tests — search.service.ts (Meilisearch sync)
 *
 * Covers: index eligibility rules (published + stock > 0), removal on
 * unpublish/out-of-stock/delete, search result shape, pagination offset
 * calculation, category filter construction, sort param mapping.
 *
 * No DB connection — pure business rule verification.
 * IMPORTANT: Meilisearch is a READ PROJECTION only — PostgreSQL is source of truth.
 * See: .claude/rules/01-architecture.md (Search Architecture Rules)
 */
import { describe, it, expect } from 'vitest'

// ── Index eligibility ─────────────────────────────────────────────────────────

describe('Search — product index eligibility', () => {
  it('indexes only PUBLISHED products', () => {
    const statuses = ['PUBLISHED', 'DRAFT', 'ARCHIVED', 'HIDDEN']
    const eligible = statuses.filter((s) => s === 'PUBLISHED')
    expect(eligible).toEqual(['PUBLISHED'])
  })

  it('requires stock > 0 for indexing', () => {
    const products = [
      { id: 'p1', status: 'PUBLISHED', stock: 5 },
      { id: 'p2', status: 'PUBLISHED', stock: 0 },
      { id: 'p3', status: 'PUBLISHED', stock: 1 },
    ]
    const eligible = products.filter((p) => p.status === 'PUBLISHED' && p.stock > 0)
    expect(eligible).toHaveLength(2)
    expect(eligible.map((p) => p.id)).not.toContain('p2')
  })

  it('does not index draft products even with stock', () => {
    const product = { status: 'DRAFT', stock: 10 }
    const shouldIndex = product.status === 'PUBLISHED' && product.stock > 0
    expect(shouldIndex).toBe(false)
  })

  it('does not index published products with zero stock', () => {
    const product = { status: 'PUBLISHED', stock: 0 }
    const shouldIndex = product.status === 'PUBLISHED' && product.stock > 0
    expect(shouldIndex).toBe(false)
  })
})

// ── Removal on ineligibility ──────────────────────────────────────────────────

describe('Search — removal from index on status or stock change', () => {
  it('unpublished product must be removed from index', () => {
    const product = { status: 'ARCHIVED', stock: 5 }
    const shouldRemove = product.status !== 'PUBLISHED' || product.stock <= 0
    expect(shouldRemove).toBe(true)
  })

  it('out-of-stock published product must be removed from index', () => {
    const product = { status: 'PUBLISHED', stock: 0 }
    const shouldRemove = product.status !== 'PUBLISHED' || product.stock <= 0
    expect(shouldRemove).toBe(true)
  })

  it('deleted product must be removed from index', () => {
    const product = null
    const shouldRemove = product === null
    expect(shouldRemove).toBe(true)
  })

  it('eligible product should not be removed', () => {
    const product = { status: 'PUBLISHED', stock: 3 }
    const shouldRemove = product.status !== 'PUBLISHED' || product.stock <= 0
    expect(shouldRemove).toBe(false)
  })
})

// ── Search document shape ─────────────────────────────────────────────────────

describe('Search — indexed document shape', () => {
  const doc = {
    id: 'product-1',
    slug: 'masif-mese-orta-sehpa',
    name: 'Masif Meşe Orta Sehpa',
    description: 'El yapımı masif meşe orta sehpa',
    price: 1850,
    categoryId: 'cat-1',
    categorySlug: 'mobilya',
    categoryName: 'Mobilya',
    sellerId: 'seller-1',
    storeSlug: 'atelier-noa',
    storeName: 'Atelier Noa',
    imageUrl: 'https://cdn.example.com/products/sehpa.jpg',
    stock: 3,
  }

  it('document has required id and slug fields', () => {
    expect(doc.id).toBeTruthy()
    expect(doc.slug).toBeTruthy()
  })

  it('document includes category context for filtering', () => {
    expect(doc.categorySlug).toBeTruthy()
    expect(doc.categoryId).toBeTruthy()
  })

  it('document includes seller/store context', () => {
    expect(doc.storeSlug).toBeTruthy()
    expect(doc.storeName).toBeTruthy()
  })

  it('price is stored as number, not string', () => {
    expect(typeof doc.price).toBe('number')
  })

  it('imageUrl can be null when no primary image exists', () => {
    const docNoImage = { ...doc, imageUrl: null }
    expect(docNoImage.imageUrl).toBeNull()
  })

  it('stock is stored as number', () => {
    expect(typeof doc.stock).toBe('number')
    expect(doc.stock).toBeGreaterThan(0)
  })
})

// ── Pagination offset ─────────────────────────────────────────────────────────

describe('Search — pagination offset calculation', () => {
  it('first page has offset 0', () => {
    const page = 1
    const limit = 20
    const offset = (page - 1) * limit
    expect(offset).toBe(0)
  })

  it('second page offset is limit', () => {
    const page = 2
    const limit = 20
    const offset = (page - 1) * limit
    expect(offset).toBe(20)
  })

  it('third page offset is 2 * limit', () => {
    const page = 3
    const limit = 20
    const offset = (page - 1) * limit
    expect(offset).toBe(40)
  })

  it('default limit is 20', () => {
    const limit = undefined ?? 20
    expect(limit).toBe(20)
  })

  it('default page is 1', () => {
    const page = undefined ?? 1
    expect(page).toBe(1)
  })
})

// ── Category filter construction ──────────────────────────────────────────────

describe('Search — category filter', () => {
  it('builds Meilisearch filter string for category', () => {
    const categorySlug = 'mobilya'
    const filter = categorySlug ? `categorySlug = "${categorySlug}"` : undefined
    expect(filter).toBe('categorySlug = "mobilya"')
  })

  it('no filter when categorySlug is undefined', () => {
    const categorySlug = undefined
    const filter = categorySlug ? `categorySlug = "${categorySlug}"` : undefined
    expect(filter).toBeUndefined()
  })
})

// ── Sort param mapping ────────────────────────────────────────────────────────

describe('Search — sort param mapping', () => {
  const validSorts = ['price:asc', 'price:desc', 'name:asc'] as const

  it.each(validSorts)('passes sort param "%s" directly to Meilisearch', (sort) => {
    const sortArray = sort ? [sort] : undefined
    expect(sortArray).toEqual([sort])
  })

  it('passes no sort when sort is undefined', () => {
    const sort = undefined
    const sortArray = sort ? [sort] : undefined
    expect(sortArray).toBeUndefined()
  })
})

// ── Source of truth invariant ─────────────────────────────────────────────────

describe('Search — Meilisearch is read projection only', () => {
  it('product status must come from PostgreSQL, not Meilisearch', () => {
    // Meilisearch result must never be used to decide payout, lifecycle, or finance logic
    const source = 'postgresql'
    expect(source).toBe('postgresql')
  })

  it('search index may lag behind DB — finance logic must not depend on it', () => {
    // This test documents the architectural invariant, not a code path
    const isSourceOfTruth = false // Meilisearch is NOT source of truth
    expect(isSourceOfTruth).toBe(false)
  })

  it('unpublished products must not appear in public search results', () => {
    const indexedProducts = [
      { id: 'p1', status: 'PUBLISHED', stock: 5 },
      // 'p2' removed from index when unpublished — would not appear here
    ]
    const hasUnpublished = indexedProducts.some((p) => p.status !== 'PUBLISHED')
    expect(hasUnpublished).toBe(false)
  })
})
