import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listCategories } = vi.hoisted(() => ({ listCategories: vi.fn() }))
// Next's RSC renderer supplies cache; the plain React 18 Node test renderer does not.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T>(fn: T): T => fn,
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/catalog.service', () => ({
  createCatalogService: () => ({ listCustomerVisibleRootCategories: listCategories }),
}))
vi.mock('@hanuja/ui', () => ({ Breadcrumb: () => null }))

import { generateMetadata } from '../../apps/web/src/app/(storefront)/kategori/page'

beforeEach(() => {
  listCategories.mockReset()
})

describe('category index SEO follows customer-visible inventory', () => {
  it('marks the actually empty category index noindex,follow', async () => {
    listCategories.mockResolvedValue([])
    const metadata = await generateMetadata()
    expect(metadata.robots).toEqual({ index: false, follow: true })
    expect(metadata.alternates?.canonical).toMatch(/\/kategori$/)
  })

  it('removes the noindex directive when a customer-visible root is available', async () => {
    listCategories.mockResolvedValue([{ id: 'ev', slug: 'ev', name: 'Ev' }])
    expect((await generateMetadata()).robots).toBeUndefined()
  })

  it('does not turn a failed catalog lookup into an empty-catalog noindex response', async () => {
    listCategories.mockRejectedValue(new Error('catalog temporarily unavailable'))
    await expect(generateMetadata()).rejects.toThrow('catalog temporarily unavailable')
  })
})
