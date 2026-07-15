import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findManyMock, fetchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('../../../api/lib/prisma', () => ({
  prisma: {
    product: {
      findMany: findManyMock,
    },
  },
}))

vi.mock('../../../api/lib/meilisearch', () => ({
  getMeilisearchConfig: () => ({
    baseUrl: 'http://meili.test',
    apiKey: 'secret',
  }),
}))

import { processSearchIndexSync } from '../../../api/jobs/search-index-sync.job'

describe('search-index-sync.job', () => {
  beforeEach(() => {
    findManyMock.mockReset()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('clears the index before a full product reindex and uploads published documents', async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 'prod-1',
          slug: 'sehpa',
          name: 'Sehpa',
          description: 'Masif',
          price: { toNumber: () => 1000 },
          categoryId: 'cat-1',
          sellerId: 'seller-1',
          stockQuantity: 7,
          images: [{ url: 'https://cdn.example.com/1.jpg' }],
          category: { slug: 'mobilya', name: 'Mobilya' },
          seller: { slug: 'atolye', displayName: 'Atolye' },
        },
      ])
      .mockResolvedValueOnce([])

    await processSearchIndexSync({
      data: { type: 'product', operation: 'upsert' },
    } as never)

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://meili.test/indexes/products/documents',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://meili.test/indexes/products/documents',
      expect.objectContaining({ method: 'POST' }),
    )
    const secondCall = fetchMock.mock.calls[1]
    const body = JSON.parse(String(secondCall?.[1]?.body ?? '[]'))
    expect(body).toEqual([
      expect.objectContaining({
        id: 'prod-1',
        categorySlug: 'mobilya',
        storeSlug: 'atolye',
      }),
    ])
  })

  it('reindexes published products for a category scope', async () => {
    findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    await processSearchIndexSync({
      data: { type: 'category', operation: 'upsert', entityId: 'cat-42' },
    } as never)

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              status: 'published',
              seller: { is: { status: 'active' } },
            },
            { categoryId: 'cat-42' },
          ],
        },
      }),
    )
  })

  it('removes a product from the index when a scoped upsert finds no published row', async () => {
    findManyMock.mockResolvedValueOnce([])

    await processSearchIndexSync({
      data: { type: 'product', operation: 'upsert', entityId: 'prod-missing' },
    } as never)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://meili.test/indexes/products/documents/prod-missing',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
