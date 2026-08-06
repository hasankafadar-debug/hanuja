import { describe, expect, it } from 'vitest'
import {
  resolveCategoryDrilldown,
  type ListingCategoryNode,
} from '../../apps/web/src/lib/product-listing-query'

/**
 * The filter panel steps down one level at a time until the leaf. Before this,
 * it always listed the page category's direct children, so a shopper who
 * entered at "Ev" could reach "Mobilya" but never "Sehpa" or "Orta Sehpa".
 */

const CATEGORIES: ListingCategoryNode[] = [
  { id: 'ev', slug: 'ev', name: 'Ev', parentId: null },
  { id: 'ofis', slug: 'ofis', name: 'Ofis', parentId: null },
  { id: 'mobilya', slug: 'mobilya', name: 'Mobilya', parentId: 'ev' },
  { id: 'aydinlatma', slug: 'aydinlatma', name: 'Aydınlatma', parentId: 'ev' },
  { id: 'sehpa', slug: 'sehpa', name: 'Sehpa', parentId: 'mobilya' },
  { id: 'orta-sehpa', slug: 'orta-sehpa', name: 'Orta Sehpa', parentId: 'sehpa' },
  { id: 'yan-sehpa', slug: 'yan-sehpa', name: 'Yan Sehpa', parentId: 'sehpa' },
  { id: 'zigon-sehpa', slug: 'zigon-sehpa', name: 'Zigon Sehpa', parentId: 'sehpa' },
]

const names = (refs: Array<{ name: string }>) => refs.map((ref) => ref.name)

describe('resolveCategoryDrilldown — category page scope', () => {
  const scope = { slugParts: ['ev'], allCategories: CATEGORIES, resolvedCategoryId: 'ev' }

  it('starts at the page category’s direct children with an empty trail', () => {
    const { trail, children } = resolveCategoryDrilldown(scope)
    expect(trail).toEqual([])
    expect(names(children)).toEqual(['Mobilya', 'Aydınlatma'])
  })

  it('descends a level when a child is selected', () => {
    const { trail, children } = resolveCategoryDrilldown({ ...scope, subcategorySlug: 'mobilya' })
    expect(names(trail)).toEqual(['Mobilya'])
    expect(names(children)).toEqual(['Sehpa'])
  })

  it('keeps descending to the leaf, exposing the full path back up', () => {
    const { trail, children } = resolveCategoryDrilldown({ ...scope, subcategorySlug: 'sehpa' })
    expect(names(trail)).toEqual(['Mobilya', 'Sehpa'])
    expect(names(children)).toEqual(['Orta Sehpa', 'Yan Sehpa', 'Zigon Sehpa'])
  })

  it('reports no further children once a leaf is selected', () => {
    const { trail, children } = resolveCategoryDrilldown({
      ...scope,
      subcategorySlug: 'orta-sehpa',
    })
    expect(names(trail)).toEqual(['Mobilya', 'Sehpa', 'Orta Sehpa'])
    expect(children).toEqual([])
  })

  it('stops the trail at the page scope rather than walking to the tree root', () => {
    const { trail } = resolveCategoryDrilldown({
      slugParts: ['ev', 'mobilya'],
      allCategories: CATEGORIES,
      resolvedCategoryId: 'mobilya',
      subcategorySlug: 'orta-sehpa',
    })
    // Page is already Mobilya, so the trail starts below it.
    expect(names(trail)).toEqual(['Sehpa', 'Orta Sehpa'])
  })

  it('ignores an unknown alt slug and shows the scope level', () => {
    const { trail, children } = resolveCategoryDrilldown({
      ...scope,
      subcategorySlug: 'yok-boyle-bir-kategori',
    })
    expect(trail).toEqual([])
    expect(names(children)).toEqual(['Mobilya', 'Aydınlatma'])
  })
})

describe('resolveCategoryDrilldown — /urunler scope', () => {
  const scope = { slugParts: [] as string[], allCategories: CATEGORIES }

  it('offers the root categories when nothing is selected', () => {
    const { trail, children } = resolveCategoryDrilldown(scope)
    expect(trail).toEqual([])
    expect(names(children)).toEqual(['Ev', 'Ofis'])
  })

  it('walks the trail up to the root category', () => {
    const { trail, children } = resolveCategoryDrilldown({ ...scope, subcategorySlug: 'sehpa' })
    expect(names(trail)).toEqual(['Ev', 'Mobilya', 'Sehpa'])
    expect(names(children)).toEqual(['Orta Sehpa', 'Yan Sehpa', 'Zigon Sehpa'])
  })
})

describe('resolveCategoryDrilldown — malformed tree', () => {
  it('terminates on a parent cycle instead of looping forever', () => {
    const cyclic: ListingCategoryNode[] = [
      { id: 'a', slug: 'a', name: 'A', parentId: 'b' },
      { id: 'b', slug: 'b', name: 'B', parentId: 'a' },
    ]
    const { trail } = resolveCategoryDrilldown({
      slugParts: [],
      allCategories: cyclic,
      subcategorySlug: 'a',
    })
    expect(names(trail)).toEqual(['B', 'A'])
  })
})
