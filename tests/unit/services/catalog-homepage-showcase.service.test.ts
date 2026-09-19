import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enqueueCategorySyncMock, enqueueProductSyncMock } = vi.hoisted(() => ({
  enqueueCategorySyncMock: vi.fn(),
  enqueueProductSyncMock: vi.fn(),
}))

vi.mock('../../../api/jobs/search-index-sync.job', () => ({
  enqueueCategorySync: enqueueCategorySyncMock,
  enqueueProductSync: enqueueProductSyncMock,
}))

import { createCatalogService } from '../../../api/services/catalog.service'
import type { ShowcaseGroup } from '../../../api/domain/homepage-showcase'

function dec(value: number) {
  return { toNumber: () => value }
}

function publishedProduct(overrides: {
  id: string
  categoryId: string
  price?: number
  compareAtPrice?: number | null
  publishedAt?: string
}) {
  return {
    id: overrides.id,
    name: overrides.id,
    slug: overrides.id,
    sellerId: 'seller-1',
    categoryId: overrides.categoryId,
    price: dec(overrides.price ?? 100),
    compareAtPrice: overrides.compareAtPrice == null ? null : dec(overrides.compareAtPrice),
    publishedAt: new Date(overrides.publishedAt ?? '2026-06-01'),
    createdAt: new Date('2026-05-01'),
    images: [{ url: `https://media.hanuja.tr/${overrides.id}.jpg` }],
    seller: { id: 'seller-1', displayName: 'Atelier', slug: 'atelier' },
    category: { id: overrides.categoryId, slug: overrides.categoryId },
  }
}

const GROUPS: ShowcaseGroup[] = [
  { key: 'ev-mobilya-ofis-mobilya', categoryIds: ['ev-mobilya', 'ofis-mobilya'] },
  { key: 'ev-aydinlatma-ofis-aydinlatma', categoryIds: ['ev-aydinlatma'] },
  { key: 'ev-mutfak', categoryIds: ['ev-mutfak'] },
  { key: 'ev', categoryIds: ['ev', 'ev-mobilya', 'ev-aydinlatma', 'ev-mutfak'] },
  { key: 'ofis', categoryIds: ['ofis', 'ofis-mobilya'] },
]

function buildPrismaMock(products: ReturnType<typeof publishedProduct>[], salesByProductId: Record<string, number> = {}) {
  return {
    product: {
      findMany: vi.fn().mockResolvedValue(products),
    },
    favoriteProduct: {
      // Called twice per showcase: weekly window + all-time enrichment counts.
      groupBy: vi.fn().mockResolvedValue(
        products.slice(0, 1).map((product) => ({ productId: product.id, _count: { productId: 2 } })),
      ),
    },
    orderLine: {
      groupBy: vi.fn().mockResolvedValue(
        Object.entries(salesByProductId).map(([productId, quantity]) => ({
          productId,
          _sum: { quantity },
        })),
      ),
    },
    discountRule: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  }
}

describe('catalog.service getHomepageShowcase', () => {
  beforeEach(() => {
    enqueueCategorySyncMock.mockReset()
    enqueueProductSyncMock.mockReset()
  })

  it('loads the published catalog exactly once regardless of the number of featured groups', async () => {
    const prisma = buildPrismaMock(
      [
        publishedProduct({ id: 'koltuk', categoryId: 'ev-mobilya' }),
        publishedProduct({ id: 'lamba', categoryId: 'ev-aydinlatma' }),
        publishedProduct({ id: 'masa', categoryId: 'ofis-mobilya' }),
        publishedProduct({ id: 'tencere', categoryId: 'ev-mutfak', price: 80, compareAtPrice: 100 }),
      ],
      { koltuk: 5, masa: 3 },
    )
    const service = createCatalogService({ prisma: prisma as never })

    const showcase = await service.getHomepageShowcase(GROUPS, {
      weeklyFavorites: 20,
      campaignDiscounts: 25,
    })

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.discountRule.findMany).toHaveBeenCalledTimes(1)
    expect(prisma.orderLine.groupBy).toHaveBeenCalledTimes(1)
    expect(prisma.favoriteProduct.groupBy).toHaveBeenCalledTimes(2)

    // One best seller per group, no repeats across overlapping groups.
    expect(showcase.featured.map((p) => p.id)).toEqual(['koltuk', 'lamba', 'tencere', 'masa'])
    expect(showcase.weeklyFavorites.length).toBeGreaterThan(0)
    // No DiscountRule campaigns in this fixture → no campaign section content.
    expect(showcase.campaignDiscounts).toEqual([])
  })

  it('returns three empty showcases for an empty catalog without extra queries', async () => {
    const prisma = buildPrismaMock([])
    const service = createCatalogService({ prisma: prisma as never })

    const showcase = await service.getHomepageShowcase(GROUPS, {
      weeklyFavorites: 20,
      campaignDiscounts: 25,
    })

    expect(showcase).toEqual({ featured: [], weeklyFavorites: [], campaignDiscounts: [] })
    expect(prisma.product.findMany).toHaveBeenCalledTimes(1)
    // enrichPublishedProducts short-circuits the per-product groupBys when there are no ids.
    expect(prisma.orderLine.groupBy).not.toHaveBeenCalled()
  })

  it('propagates a catalog load failure instead of returning an empty showcase', async () => {
    const prisma = buildPrismaMock([])
    prisma.product.findMany.mockRejectedValueOnce(new Error('connection refused'))
    const service = createCatalogService({ prisma: prisma as never })

    await expect(
      service.getHomepageShowcase(GROUPS, { weeklyFavorites: 20, campaignDiscounts: 25 }),
    ).rejects.toThrow('connection refused')
  })
})
