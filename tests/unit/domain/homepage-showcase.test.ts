import { describe, expect, it } from 'vitest'
import {
  selectCampaignDiscountShowcase,
  selectWeeklyFavoriteShowcase,
  type ShowcaseGroup,
  type ShowcaseProduct,
} from '../../../api/domain/homepage-showcase'

function dec(value: number): { toNumber(): number } {
  return { toNumber: () => value }
}

function product(overrides: Partial<ShowcaseProduct> & { id: string }): ShowcaseProduct {
  return {
    categoryId: null,
    name: overrides.id,
    salesCount: 0,
    rankingDate: new Date('2026-01-01'),
    price: dec(100),
    compareAtPrice: null,
    discountSource: null,
    ...overrides,
  }
}

function counts(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries)
}

describe('selectWeeklyFavoriteShowcase', () => {
  const groups: ShowcaseGroup[] = [
    { key: 'mobilya', categoryIds: ['cat-mobilya', 'cat-mobilya-sehpa'] },
    { key: 'aydinlatma', categoryIds: ['cat-aydinlatma'] },
  ]

  it('picks the most weekly-favorited product per group first', () => {
    const products = [
      product({ id: 'sehpa', categoryId: 'cat-mobilya-sehpa' }),
      product({ id: 'koltuk', categoryId: 'cat-mobilya' }),
      product({ id: 'lamba', categoryId: 'cat-aydinlatma' }),
    ]
    const picked = selectWeeklyFavoriteShowcase(
      products,
      counts([
        ['sehpa', 5],
        ['koltuk', 9],
        ['lamba', 2],
      ]),
      groups,
      2,
    )
    expect(picked.map((p) => p.id)).toEqual(['koltuk', 'lamba'])
  })

  it('ignores products without weekly favorites in the group pass', () => {
    const products = [
      product({ id: 'koltuk', categoryId: 'cat-mobilya' }),
      product({ id: 'lamba', categoryId: 'cat-aydinlatma' }),
    ]
    const picked = selectWeeklyFavoriteShowcase(
      products,
      counts([['lamba', 1]]),
      groups,
      1,
    )
    expect(picked.map((p) => p.id)).toEqual(['lamba'])
  })

  it('fills remaining slots with the next most weekly-favorited products overall', () => {
    const products = [
      product({ id: 'koltuk', categoryId: 'cat-mobilya' }),
      product({ id: 'vazo-a', categoryId: 'cat-dekor' }),
      product({ id: 'vazo-b', categoryId: 'cat-dekor' }),
    ]
    const picked = selectWeeklyFavoriteShowcase(
      products,
      counts([
        ['koltuk', 3],
        ['vazo-a', 7],
        ['vazo-b', 4],
      ]),
      groups,
      3,
    )
    // Pass 1: koltuk (group mobilya). Pass 2: vazo-a (7), vazo-b (4).
    expect(picked.map((p) => p.id)).toEqual(['koltuk', 'vazo-a', 'vazo-b'])
  })

  it('fills with any published product (salesCount, then recency) when favorites run out', () => {
    const products = [
      product({ id: 'fav', categoryId: 'cat-mobilya' }),
      product({ id: 'bestseller', salesCount: 12, rankingDate: new Date('2025-06-01') }),
      product({ id: 'newest', salesCount: 0, rankingDate: new Date('2026-03-01') }),
      product({ id: 'older', salesCount: 0, rankingDate: new Date('2025-01-01') }),
    ]
    const picked = selectWeeklyFavoriteShowcase(
      products,
      counts([['fav', 1]]),
      groups,
      3,
    )
    expect(picked.map((p) => p.id)).toEqual(['fav', 'bestseller', 'newest'])
  })

  it('never picks the same product twice even when it matches several groups', () => {
    const overlappingGroups: ShowcaseGroup[] = [
      { key: 'a', categoryIds: ['cat-x'] },
      { key: 'b', categoryIds: ['cat-x'] },
    ]
    const products = [
      product({ id: 'tek', categoryId: 'cat-x' }),
      product({ id: 'yedek', categoryId: 'cat-x' }),
    ]
    const picked = selectWeeklyFavoriteShowcase(
      products,
      counts([
        ['tek', 5],
        ['yedek', 1],
      ]),
      overlappingGroups,
      10,
    )
    expect(picked.map((p) => p.id)).toEqual(['tek', 'yedek'])
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length)
  })

  it('never exceeds the limit', () => {
    const products = Array.from({ length: 30 }, (_, i) =>
      product({ id: `p${i}`, categoryId: 'cat-mobilya' }),
    )
    const weekly = counts(products.map((p, i): [string, number] => [p.id, i + 1]))
    const picked = selectWeeklyFavoriteShowcase(products, weekly, groups, 20)
    expect(picked).toHaveLength(20)
  })

  it('returns everything available when catalog is smaller than the limit', () => {
    const products = [product({ id: 'a' }), product({ id: 'b' })]
    const picked = selectWeeklyFavoriteShowcase(products, counts([]), groups, 20)
    expect(picked).toHaveLength(2)
  })
})

describe('selectCampaignDiscountShowcase', () => {
  const cutoff = new Date('2026-04-07')

  function campaignProduct(
    id: string,
    params: { price: number; compareAt: number; startsAt: Date },
  ): ShowcaseProduct {
    return product({
      id,
      price: dec(params.price),
      compareAtPrice: dec(params.compareAt),
      discountSource: { effectiveStartsAt: params.startsAt },
    })
  }

  it('excludes products without an active discount rule', () => {
    const staticDiscount = product({
      id: 'statik',
      price: dec(80),
      compareAtPrice: dec(100),
      discountSource: null,
    })
    expect(selectCampaignDiscountShowcase([staticDiscount], cutoff)).toEqual([])
  })

  it('excludes campaigns that started before the cutoff date', () => {
    const oldCampaign = campaignProduct('eski', {
      price: 50,
      compareAt: 100,
      startsAt: new Date('2026-01-01'),
    })
    const freshCampaign = campaignProduct('yeni', {
      price: 90,
      compareAt: 100,
      startsAt: new Date('2026-05-01'),
    })
    const picked = selectCampaignDiscountShowcase([oldCampaign, freshCampaign], cutoff)
    expect(picked.map((p) => p.id)).toEqual(['yeni'])
  })

  it('sorts by highest discount percent against the real sale price', () => {
    const small = campaignProduct('kucuk', {
      price: 90,
      compareAt: 100, // %10
      startsAt: new Date('2026-05-01'),
    })
    const big = campaignProduct('buyuk', {
      price: 40,
      compareAt: 100, // %60
      startsAt: new Date('2026-05-01'),
    })
    const mid = campaignProduct('orta', {
      price: 150,
      compareAt: 200, // %25
      startsAt: new Date('2026-05-01'),
    })
    const picked = selectCampaignDiscountShowcase([small, big, mid], cutoff)
    expect(picked.map((p) => p.id)).toEqual(['buyuk', 'orta', 'kucuk'])
  })

  it('guards against zero or non-positive markdowns', () => {
    const noMarkdown = campaignProduct('esit', {
      price: 100,
      compareAt: 100,
      startsAt: new Date('2026-05-01'),
    })
    const missingCompareAt = product({
      id: 'karsilastirmasiz',
      price: dec(100),
      compareAtPrice: null,
      discountSource: { effectiveStartsAt: new Date('2026-05-01') },
    })
    expect(selectCampaignDiscountShowcase([noMarkdown, missingCompareAt], cutoff)).toEqual([])
  })

  it('caps at the limit and does NOT fill with non-campaign products', () => {
    const campaigns = Array.from({ length: 5 }, (_, i) =>
      campaignProduct(`k${i}`, {
        price: 100 - (i + 1) * 10,
        compareAt: 100,
        startsAt: new Date('2026-05-01'),
      }),
    )
    const filler = product({ id: 'dolgu' })
    const pickedCapped = selectCampaignDiscountShowcase([...campaigns, filler], cutoff, 3)
    expect(pickedCapped).toHaveLength(3)
    const pickedAll = selectCampaignDiscountShowcase([...campaigns, filler], cutoff, 25)
    expect(pickedAll).toHaveLength(5)
    expect(pickedAll.some((p) => p.id === 'dolgu')).toBe(false)
  })

  it('includes a campaign starting exactly on the cutoff date', () => {
    const edge = campaignProduct('sinir', {
      price: 80,
      compareAt: 100,
      startsAt: new Date('2026-04-07'),
    })
    expect(selectCampaignDiscountShowcase([edge], cutoff).map((p) => p.id)).toEqual(['sinir'])
  })
})
