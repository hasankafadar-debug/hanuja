import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZE,
  buildCuratedListOptions,
  buildListingQueryString,
  buildPaginationHrefs,
  collectCategoryIds,
  parseListingSearchParams,
  parsePriceParams,
  resolveListingCategoryIds,
  type ListingCategoryNode,
} from '../../apps/web/src/lib/product-listing-query'

/**
 * The listing page renders page 1 and the infinite-scroll API serves 2..N.
 * Both call these helpers, so a divergence here would silently mix two
 * different result sets as the shopper scrolls. These tests pin that contract.
 */

// Mirrors the real slugs: the "mobilya" nav item is a virtual collection over
// ev-mobilya + ofis-mobilya (see VIRTUAL_COLLECTION_MAP), not a category itself.
const CATEGORIES: ListingCategoryNode[] = [
  { id: 'ev', slug: 'ev', name: 'Ev', parentId: null },
  { id: 'ofis', slug: 'ofis', name: 'Ofis', parentId: null },
  { id: 'ev-mobilya', slug: 'ev-mobilya', name: 'Mobilya', parentId: 'ev' },
  { id: 'ev-aydinlatma', slug: 'ev-aydinlatma', name: 'Aydınlatma', parentId: 'ev' },
  { id: 'sehpa', slug: 'sehpa', name: 'Sehpa', parentId: 'ev-mobilya' },
  { id: 'orta-sehpa', slug: 'orta-sehpa', name: 'Orta Sehpa', parentId: 'sehpa' },
  { id: 'yan-sehpa', slug: 'yan-sehpa', name: 'Yan Sehpa', parentId: 'sehpa' },
  { id: 'ofis-mobilya', slug: 'ofis-mobilya', name: 'Ofis Mobilyası', parentId: 'ofis' },
]

describe('parsePriceParams', () => {
  it('prefers fiyatMin/fiyatMax over the legacy fiyat param', () => {
    expect(
      parsePriceParams({ fiyatMin: '500', fiyatMax: '1500', fiyat: '100-200' }),
    ).toEqual({ minPrice: 500, maxPrice: 1500 })
  })

  it('parses the legacy range format', () => {
    expect(parsePriceParams({ fiyat: '500-1500' })).toEqual({ minPrice: 500, maxPrice: 1500 })
  })

  it('parses the legacy open-ended format', () => {
    expect(parsePriceParams({ fiyat: '3000+' })).toEqual({ minPrice: 3000 })
  })

  it('drops non-positive and non-numeric bounds', () => {
    expect(parsePriceParams({ fiyatMin: '0', fiyatMax: 'abc' })).toEqual({})
    expect(parsePriceParams({})).toEqual({})
  })
})

describe('parseListingSearchParams', () => {
  it('defaults to page 1 with no filters', () => {
    expect(parseListingSearchParams({})).toEqual({
      page: 1,
      inStockOnly: false,
      onSaleOnly: false,
    })
  })

  it('clamps invalid page values to 1', () => {
    expect(parseListingSearchParams({ sayfa: '0' }).page).toBe(1)
    expect(parseListingSearchParams({ sayfa: '-3' }).page).toBe(1)
    expect(parseListingSearchParams({ sayfa: 'abc' }).page).toBe(1)
    expect(parseListingSearchParams({ sayfa: '4' }).page).toBe(4)
  })

  it('ignores an unknown sort value rather than passing it through', () => {
    expect(parseListingSearchParams({ siralama: 'rastgele' }).sort).toBeUndefined()
    expect(parseListingSearchParams({ siralama: 'price-asc' }).sort).toBe('price-asc')
  })

  it('derives sort and onSale from the /urunler vitrin shelves', () => {
    expect(parseListingSearchParams({ vitrin: 'favorited' }).sort).toBe('favorited')
    expect(parseListingSearchParams({ vitrin: 'discounts' }).onSaleOnly).toBe(true)
    expect(parseListingSearchParams({ indirimli: '1' }).onSaleOnly).toBe(true)
  })

  it('lets an explicit sort win over the vitrin default', () => {
    expect(
      parseListingSearchParams({ vitrin: 'favorited', siralama: 'price-desc' }).sort,
    ).toBe('price-desc')
  })
})

describe('buildCuratedListOptions', () => {
  it('translates the page number into a skip offset', () => {
    expect(buildCuratedListOptions(parseListingSearchParams({ sayfa: '3' }), undefined)).toEqual({
      skip: 2 * PAGE_SIZE,
      take: PAGE_SIZE,
    })
  })

  it('omits inactive flags so they never reach the service as false', () => {
    const opts = buildCuratedListOptions(
      parseListingSearchParams({ stokta: '1', fiyatMin: '100' }),
      'seller-1',
    )
    expect(opts).toEqual({
      skip: 0,
      take: PAGE_SIZE,
      minPrice: 100,
      inStockOnly: true,
      sellerId: 'seller-1',
    })
    expect('onSaleOnly' in opts).toBe(false)
  })

  it('accepts an explicit page override for load-more requests', () => {
    expect(buildCuratedListOptions(parseListingSearchParams({}), undefined, 5).skip).toBe(
      4 * PAGE_SIZE,
    )
  })
})

describe('collectCategoryIds', () => {
  it('collects the whole descendant subtree, not just direct children', () => {
    expect(collectCategoryIds(['ev-mobilya'], CATEGORIES).sort()).toEqual(
      ['ev-mobilya', 'orta-sehpa', 'sehpa', 'yan-sehpa'].sort(),
    )
  })

  it('returns the root alone when it has no descendants', () => {
    expect(collectCategoryIds(['orta-sehpa'], CATEGORIES)).toEqual(['orta-sehpa'])
  })
})

describe('resolveListingCategoryIds', () => {
  it('scopes /urunler to every visible category', () => {
    const { categoryIds } = resolveListingCategoryIds({ slugParts: [], allCategories: CATEGORIES })
    expect(categoryIds).toHaveLength(CATEGORIES.length)
  })

  it('scopes a category page to its own subtree', () => {
    const { categoryIds } = resolveListingCategoryIds({
      slugParts: ['ev'],
      allCategories: CATEGORIES,
      resolvedCategoryId: 'ev',
    })
    expect(categoryIds).not.toContain('ofis')
    expect(categoryIds).toContain('orta-sehpa')
  })

  it('narrows to the alt subtree while leaving the seller facet scope intact', () => {
    const { baseCategoryIds, categoryIds } = resolveListingCategoryIds({
      slugParts: ['ev'],
      allCategories: CATEGORIES,
      resolvedCategoryId: 'ev',
      subcategorySlug: 'sehpa',
    })
    expect(categoryIds.sort()).toEqual(['orta-sehpa', 'sehpa', 'yan-sehpa'])
    expect(baseCategoryIds).toContain('ev-aydinlatma')
  })

  it('falls back to the page scope when alt names an unknown category', () => {
    const { baseCategoryIds, categoryIds } = resolveListingCategoryIds({
      slugParts: ['ev'],
      allCategories: CATEGORIES,
      resolvedCategoryId: 'ev',
      subcategorySlug: 'yok-boyle-bir-kategori',
    })
    expect(categoryIds).toEqual(baseCategoryIds)
  })

  it('expands a virtual collection to both member subtrees', () => {
    const { categoryIds } = resolveListingCategoryIds({
      slugParts: ['mobilya'],
      allCategories: CATEGORIES,
    })
    expect(categoryIds).toContain('ev-mobilya')
    expect(categoryIds).toContain('ofis-mobilya')
    // descendants of a member come along too
    expect(categoryIds).toContain('orta-sehpa')
    // but unrelated branches do not
    expect(categoryIds).not.toContain('ev-aydinlatma')
  })
})

describe('buildListingQueryString', () => {
  it('serializes active filters and omits the page', () => {
    const query = buildListingQueryString(
      parseListingSearchParams({
        sayfa: '3',
        siralama: 'price-asc',
        fiyatMin: '500',
        stokta: '1',
        alt: 'sehpa',
      }),
      'ev/mobilya',
    )
    const params = new URLSearchParams(query)
    expect(params.get('kategori')).toBe('ev/mobilya')
    expect(params.get('siralama')).toBe('price-asc')
    expect(params.get('fiyatMin')).toBe('500')
    expect(params.get('stokta')).toBe('1')
    expect(params.get('alt')).toBe('sehpa')
    expect(params.get('sayfa')).toBeNull()
  })

  it('omits kategori for the /urunler scope', () => {
    expect(buildListingQueryString(parseListingSearchParams({}))).toBe('')
  })
})

describe('buildPaginationHrefs', () => {
  it('emits crawlable links for pages 2..N', () => {
    const hrefs = buildPaginationHrefs({
      basePath: '/kategori/mobilya',
      search: {},
      totalPages: 3,
    })
    expect(hrefs.map((h) => h.page)).toEqual([2, 3])
    expect(hrefs[0]?.href).toBe('/kategori/mobilya?sayfa=2')
  })

  it('preserves the active filters so page 2 is not an unfiltered page', () => {
    const hrefs = buildPaginationHrefs({
      basePath: '/kategori/mobilya',
      search: { siralama: 'price-asc', stokta: '1', sayfa: '5' },
      totalPages: 2,
    })
    const params = new URLSearchParams(hrefs[0]!.href.split('?')[1])
    expect(params.get('siralama')).toBe('price-asc')
    expect(params.get('stokta')).toBe('1')
    // the incoming page must be replaced, not duplicated
    expect(params.getAll('sayfa')).toEqual(['2'])
  })

  it('emits nothing for a single-page listing', () => {
    expect(buildPaginationHrefs({ basePath: '/urunler', search: {}, totalPages: 1 })).toEqual([])
  })

  it('bounds the link count for very large listings', () => {
    const hrefs = buildPaginationHrefs({
      basePath: '/urunler',
      search: {},
      totalPages: 5000,
    })
    expect(hrefs).toHaveLength(99)
  })
})
