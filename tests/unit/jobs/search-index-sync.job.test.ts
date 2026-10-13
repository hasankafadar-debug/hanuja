import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  products: vi.fn(),
  fetch: vi.fn(),
  ack: vi.fn(),
  wait: vi.fn(),
  ensure: vi.fn(),
}))
vi.mock('../../../api/lib/prisma', () => {
  const db = {
    product: { findMany: mocks.products },
    category: { findMany: vi.fn(async () => []) },
    catalogTemplate: { findMany: vi.fn(async () => []) },
    catalogField: { findMany: vi.fn(async () => []) },
    searchIndexDirtyProduct: {
      findUnique: vi.fn(async () => ({ productId: 'prod-1', revision: 7 })),
      deleteMany: mocks.ack,
      findMany: vi.fn(async () => []),
    },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async () => [{ acquired: true }]),
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  }
  return { prisma: db }
})
vi.mock('../../../api/lib/meilisearch', () => ({
  getMeilisearchConfig: () => ({ baseUrl: 'http://meili.test', apiKey: 'test-only' }),
  ensureIndex: mocks.ensure,
  waitForMeilisearchTask: mocks.wait,
}))
import { processSearchIndexSync } from '../../../api/jobs/search-index-sync.job'
const document = {
  id: 'prod-1',
  slug: 'sehpa',
  name: 'Sehpa',
  description: 'Masif',
  price: { toNumber: () => 1000 },
  categoryId: null,
  sellerId: 'seller-1',
  stockQuantity: 0,
  properties: {},
  variants: [],
  attributeValues: [],
  images: [],
  category: null,
  seller: { slug: 'atolye', displayName: 'Atölye' },
}
const job = (data: unknown) => ({ data }) as never
beforeEach(() => {
  vi.clearAllMocks()
  mocks.products.mockReset()
  mocks.wait.mockReset()
  mocks.wait.mockResolvedValue(undefined)
  mocks.ensure.mockResolvedValue(undefined)
  mocks.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ taskUid: 1 }),
    text: async () => '',
  })
  vi.stubGlobal('fetch', mocks.fetch)
})
describe('durable product search projection', () => {
  it('builds separately and atomically swaps instead of emptying the live index', async () => {
    mocks.products.mockResolvedValueOnce([document]).mockResolvedValueOnce([])
    await processSearchIndexSync(job({ type: 'product', operation: 'upsert' }))
    const requests = mocks.fetch.mock.calls
    expect(requests.some(([url]) => url === 'http://meili.test/swap-indexes')).toBe(true)
    expect(
      requests.some(
        ([url, options]) =>
          url === 'http://meili.test/indexes/products/documents' && options.method === 'DELETE',
      ),
    ).toBe(false)
    const upload = requests.find(
      ([url, options]) =>
        url.includes('products_build_') && url.endsWith('/documents') && options.method === 'POST',
    )
    expect(JSON.parse(upload?.[1].body)).toEqual([
      expect.objectContaining({ id: 'prod-1', stock: 0 }),
    ])
    expect(mocks.ack).not.toHaveBeenCalled()
  })
  it('ignores stale delete jobs and reads the latest committed product', async () => {
    mocks.products.mockResolvedValueOnce([document])
    await processSearchIndexSync(job({ type: 'product', operation: 'delete', entityId: 'prod-1' }))
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://meili.test/indexes/products/documents',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(mocks.ack).toHaveBeenCalledWith({ where: { productId: 'prod-1', revision: 7 } })
  })
  it('deletes unpublished products and tombstones only after the Meili task succeeds', async () => {
    mocks.products.mockResolvedValueOnce([])
    await processSearchIndexSync(job({ type: 'product', operation: 'upsert', entityId: 'prod-1' }))
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://meili.test/indexes/products/documents/prod-1',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(mocks.ack).toHaveBeenCalledWith({ where: { productId: 'prod-1', revision: 7 } })
  })
  it('leaves durable dirty state pending when indexing fails', async () => {
    mocks.products.mockResolvedValueOnce([document])
    mocks.wait.mockRejectedValueOnce(new Error('index unavailable'))
    await expect(
      processSearchIndexSync(job({ type: 'product', operation: 'upsert', entityId: 'prod-1' })),
    ).rejects.toThrow('index unavailable')
    expect(mocks.ack).not.toHaveBeenCalled()
  })
})
