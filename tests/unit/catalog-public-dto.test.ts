import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProductBySlug: vi.fn(),
  listPublished: vi.fn(),
}))

vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute: vi.fn(() => ({})) }))
vi.mock('../../api/services/catalog.service', () => ({
  createCatalogService: () => ({
    getProductBySlug: mocks.getProductBySlug,
    listPublished: mocks.listPublished,
  }),
}))

describe('public catalog DTO', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not serialize modelCode from product detail or listing responses', async () => {
    mocks.getProductBySlug.mockResolvedValue({ id: 'product-1', name: 'Ürün', modelCode: 'INTERNAL-1' })
    mocks.listPublished.mockResolvedValue([{ id: 'product-1', name: 'Ürün', modelCode: 'INTERNAL-1' }])
    const routes = await import('../../api/routes/catalog')

    const detail = await routes.getProductBySlug('urun')
    const list = await routes.listProducts(new Request('http://localhost/api/products') as never)

    expect((await detail.json()).data).not.toHaveProperty('modelCode')
    expect((await list.json()).data[0]).not.toHaveProperty('modelCode')
  })
})
