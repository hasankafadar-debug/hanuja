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

const CATEGORY_TREE = [
  { id: 'ev', parentId: null, slug: 'ev', name: 'Ev', sortOrder: 0, isActive: true },
  { id: 'ev-mobilya', parentId: 'ev', slug: 'ev-mobilya', name: 'Mobilya', sortOrder: 0, isActive: true },
  { id: 'ev-mobilya-sehpa', parentId: 'ev-mobilya', slug: 'ev-mobilya-sehpa', name: 'Sehpa', sortOrder: 0, isActive: true },
  { id: 'ev-dekorasyon', parentId: 'ev', slug: 'ev-dekorasyon', name: 'Dekorasyon', sortOrder: 1, isActive: true },
  { id: 'ofis', parentId: null, slug: 'ofis', name: 'Ofis', sortOrder: 1, isActive: true },
  { id: 'ofis-mobilya', parentId: 'ofis', slug: 'ofis-mobilya', name: 'Ofis Mobilya', sortOrder: 0, isActive: true },
]

function buildPrismaMock(publishedCounts: Array<{ categoryId: string | null; count: number }>) {
  return {
    category: {
      findMany: vi.fn().mockResolvedValue(CATEGORY_TREE),
    },
    product: {
      groupBy: vi.fn().mockResolvedValue(
        publishedCounts.map((row) => ({
          categoryId: row.categoryId,
          _count: { _all: row.count },
        })),
      ),
    },
  } as never
}

describe('catalog.service customer-visible categories', () => {
  beforeEach(() => {
    enqueueCategorySyncMock.mockReset()
    enqueueProductSyncMock.mockReset()
  })

  it('listCustomerVisibleCategories returns only product-bearing subtrees with ancestors', async () => {
    const prisma = buildPrismaMock([{ categoryId: 'ev-mobilya-sehpa', count: 2 }])
    const service = createCatalogService({ prisma })

    const visible = await service.listCustomerVisibleCategories()

    expect(visible.map((c: { id: string }) => c.id)).toEqual(['ev', 'ev-mobilya', 'ev-mobilya-sehpa'])
  })

  it('listCustomerVisibleRootCategories returns only visible roots in sortOrder', async () => {
    const prisma = buildPrismaMock([
      { categoryId: 'ofis-mobilya', count: 1 },
      { categoryId: 'ev-dekorasyon', count: 4 },
    ])
    const service = createCatalogService({ prisma })

    const roots = await service.listCustomerVisibleRootCategories()

    expect(roots.map((c: { id: string }) => c.id)).toEqual(['ev', 'ofis'])
  })

  it('getCustomerVisibleCategoryIdSet returns empty set with no published products', async () => {
    const prisma = buildPrismaMock([])
    const service = createCatalogService({ prisma })

    const idSet = await service.getCustomerVisibleCategoryIdSet()

    expect(idSet.size).toBe(0)
  })

  it('regression guard: listAllCategories still returns the full active tree', async () => {
    const prisma = buildPrismaMock([{ categoryId: 'ev-mobilya-sehpa', count: 1 }])
    const service = createCatalogService({ prisma })

    const all = await service.listAllCategories()

    expect(all).toHaveLength(CATEGORY_TREE.length)
    expect((prisma as { category: { findMany: ReturnType<typeof vi.fn> } }).category.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    })
  })
})
