import { describe, expect, it, vi, beforeEach } from 'vitest'

const { searchIndexMock, searchPublishedMock } = vi.hoisted(() => ({
  searchIndexMock: vi.fn(),
  searchPublishedMock: vi.fn(),
}))

vi.mock('../../../api/lib/meilisearch', () => ({
  searchIndex: searchIndexMock,
}))

vi.mock('../../../api/services/catalog.service', () => ({
  createCatalogService: () => ({
    searchPublished: searchPublishedMock,
  }),
}))

import { createSearchService } from '../../../api/services/search.service'

describe('search.service', () => {
  beforeEach(() => {
    searchIndexMock.mockReset()
    searchPublishedMock.mockReset()
  })

  it('returns Meilisearch results with the shared response shape', async () => {
    searchIndexMock.mockResolvedValue({
      hits: [
        {
          id: 'prod-1',
          slug: 'masif-sehpa',
          name: 'Masif Sehpa',
          description: 'Açıklama',
          price: 1200,
          categoryId: 'cat-1',
          categorySlug: 'mobilya',
          categoryName: 'Mobilya',
          sellerId: 'seller-1',
          storeSlug: 'atolye-ornek',
          storeName: 'Atolye Ornek',
          imageUrl: 'https://cdn.example.com/1.jpg',
          imageUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
          stock: 5,
        },
      ],
      totalHits: 1,
      limit: 20,
      offset: 0,
      facetDistribution: { categorySlug: { mobilya: 1 } },
      processingTimeMs: 4,
    })

    const service = createSearchService({ prisma: {} as never })
    const result = await service.searchProducts({
      q: 'sehpa',
      categorySlug: 'mobilya',
      page: 1,
      limit: 20,
      sort: 'price:asc',
    })

    expect(searchIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indexName: 'products',
        q: 'sehpa',
        filter: 'categorySlug = "mobilya"',
        sort: ['price:asc'],
      }),
    )
    expect(searchPublishedMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      hits: expect.any(Array),
      totalHits: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
      facets: { categorySlug: { mobilya: 1 } },
      processingTimeMs: 4,
      query: 'sehpa',
    })
  })

  it('falls back to PostgreSQL when Meilisearch errors', async () => {
    searchIndexMock.mockRejectedValue(new Error('meili unavailable'))
    searchPublishedMock.mockResolvedValue({
      items: [
        {
          id: 'prod-2',
          slug: 'el-yapimi-vazo',
          name: 'El Yapimi Vazo',
          description: 'Seramik vazo',
          price: { toNumber: () => 890 },
          categoryId: 'cat-2',
          sellerId: 'seller-2',
          stockQuantity: 3,
          images: [{ url: 'https://cdn.example.com/2.jpg' }, { url: 'https://cdn.example.com/3.jpg' }],
          category: { slug: 'dekorasyon', name: 'Dekorasyon' },
          seller: { slug: 'seramik-ev', displayName: 'Seramik Ev' },
        },
      ],
      total: 1,
    })

    const service = createSearchService({ prisma: {} as never })
    const result = await service.searchProducts({
      q: 'vazo',
      page: 2,
      limit: 10,
      sort: 'name:asc',
    })

    expect(searchPublishedMock).toHaveBeenCalledWith({
      q: 'vazo',
      sortBy: 'name-asc',
      skip: 10,
      take: 10,
    })
    expect(result.hits[0]).toMatchObject({
      id: 'prod-2',
      slug: 'el-yapimi-vazo',
      categorySlug: 'dekorasyon',
      storeSlug: 'seramik-ev',
      storeName: 'Seramik Ev',
      imageUrls: ['https://cdn.example.com/2.jpg', 'https://cdn.example.com/3.jpg'],
      stock: 3,
    })
    expect(result.totalPages).toBe(1)
    expect(result.processingTimeMs).toBe(0)
  })

  it('falls back to PostgreSQL when Meilisearch returns zero hits', async () => {
    searchIndexMock.mockResolvedValue({
      hits: [],
      totalHits: 0,
      limit: 20,
      offset: 0,
      processingTimeMs: 2,
    })
    searchPublishedMock.mockResolvedValue({
      items: [],
      total: 0,
    })

    const service = createSearchService({ prisma: {} as never })
    const result = await service.searchProducts({ q: 'olmayan' })

    expect(searchPublishedMock).toHaveBeenCalledOnce()
    expect(result.totalHits).toBe(0)
    expect(result.totalPages).toBe(1)
  })
})
