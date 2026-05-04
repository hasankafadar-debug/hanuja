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

describe('catalog.service category updates', () => {
  beforeEach(() => {
    enqueueCategorySyncMock.mockReset()
    enqueueCategorySyncMock.mockResolvedValue(undefined)
    enqueueProductSyncMock.mockReset()
    enqueueProductSyncMock.mockResolvedValue(undefined)
  })

  it('updates a category and enqueues category reindex', async () => {
    const prisma = {
      category: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'cat-1',
            name: 'Mobilya',
            slug: 'mobilya',
            description: null,
            imageUrl: null,
            sortOrder: 0,
            isActive: true,
            children: [],
            parent: null,
          })
          .mockResolvedValueOnce(null),
        update: vi.fn().mockResolvedValue({
          id: 'cat-1',
          name: 'Yeni Mobilya',
          slug: 'yeni-mobilya',
        }),
      },
    } as never

    const service = createCatalogService({ prisma })
    const result = await service.updateCategoryForAdmin({
      categoryId: 'cat-1',
      name: 'Yeni Mobilya',
      slug: 'Yeni Mobilya',
      sortOrder: 3,
      isActive: false,
    })

    expect(prisma.category.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: {
        name: 'Yeni Mobilya',
        slug: 'yeni-mobilya',
        sortOrder: 3,
        isActive: false,
      },
    })
    expect(enqueueCategorySyncMock).toHaveBeenCalledWith({ entityId: 'cat-1' })
    expect(result).toEqual({
      id: 'cat-1',
      name: 'Yeni Mobilya',
      slug: 'yeni-mobilya',
    })
  })

  it('rejects duplicate category slug', async () => {
    const prisma = {
      category: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'cat-1',
            name: 'Mobilya',
            slug: 'mobilya',
            description: null,
            imageUrl: null,
            sortOrder: 0,
            isActive: true,
            children: [],
            parent: null,
          })
          .mockResolvedValueOnce({
            id: 'cat-2',
            name: 'Dekorasyon',
            slug: 'dekorasyon',
            description: null,
            imageUrl: null,
            sortOrder: 0,
            isActive: true,
            children: [],
            parent: null,
          }),
      },
    } as never

    const service = createCatalogService({ prisma })

    await expect(
      service.updateCategoryForAdmin({
        categoryId: 'cat-1',
        slug: 'dekorasyon',
      }),
    ).rejects.toThrow('Bu slug kullanımda: dekorasyon')

    expect(enqueueCategorySyncMock).not.toHaveBeenCalled()
  })
})
