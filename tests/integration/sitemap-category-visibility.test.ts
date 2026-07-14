/**
 * Integration tests — sitemap category visibility
 *
 * The sitemap must:
 * 1. Exclude categories whose subtree has no published product
 * 2. Include a filled category AND its ancestors, with full hierarchical paths
 * 3. Fall back to the static sitemap when the DB is unreachable
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    category: { findMany: vi.fn() },
    product: { groupBy: vi.fn(), findMany: vi.fn() },
    blogPost: { findMany: vi.fn() },
    seller: { findMany: vi.fn() },
    favoriteProduct: { groupBy: vi.fn() },
    orderLine: { groupBy: vi.fn() },
  },
}))

vi.mock('../../api/lib/prisma', () => ({
  prisma: prismaMock,
  createPrismaForRoute: () => prismaMock,
  default: prismaMock,
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  addJob: vi.fn(),
}))

vi.mock('../../api/lib/meilisearch', () => ({ getMeilisearchClient: vi.fn() }))
vi.mock('../../api/lib/r2', () => ({ getR2Client: vi.fn() }))

vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueCategorySync: vi.fn(),
  enqueueProductSync: vi.fn(),
}))

import sitemap from '../../apps/web/src/app/sitemap'

const NOW = new Date('2026-07-05T00:00:00Z')

const CATEGORY_TREE = [
  { id: 'ev', parentId: null, slug: 'ev', name: 'Ev', sortOrder: 0, isActive: true, updatedAt: NOW },
  { id: 'ev-mobilya', parentId: 'ev', slug: 'ev-mobilya', name: 'Mobilya', sortOrder: 0, isActive: true, updatedAt: NOW },
  { id: 'ev-mobilya-sehpa', parentId: 'ev-mobilya', slug: 'ev-mobilya-sehpa', name: 'Sehpa', sortOrder: 0, isActive: true, updatedAt: NOW },
  { id: 'ofis', parentId: null, slug: 'ofis', name: 'Ofis', sortOrder: 1, isActive: true, updatedAt: NOW },
]

function urlsOf(entries: Array<{ url: string }>) {
  return entries.map((entry) => new URL(entry.url).pathname)
}

beforeEach(() => {
  prismaMock.category.findMany.mockReset()
  prismaMock.product.groupBy.mockReset()
  prismaMock.product.findMany.mockReset()
  prismaMock.blogPost.findMany.mockReset()
  prismaMock.seller.findMany.mockReset()

  prismaMock.category.findMany.mockResolvedValue(CATEGORY_TREE)
  prismaMock.product.groupBy.mockResolvedValue([])
  prismaMock.product.findMany.mockResolvedValue([])
  prismaMock.blogPost.findMany.mockResolvedValue([])
  prismaMock.seller.findMany.mockResolvedValue([])
})

describe('sitemap category visibility', () => {
  it('excludes categories with no published product in their subtree', async () => {
    const entries = await sitemap()
    const paths = urlsOf(entries)

    expect(paths.some((path) => path.startsWith('/kategori'))).toBe(false)
    // Home + blog list entries still present.
    expect(paths).toContain('/')
    expect(paths).toContain('/blog')
  })

  it('includes a filled category and its ancestors with full hierarchical paths', async () => {
    prismaMock.product.groupBy.mockResolvedValue([
      { categoryId: 'ev-mobilya-sehpa', _count: { _all: 1 } },
    ])

    const entries = await sitemap()
    const paths = urlsOf(entries)

    expect(paths).toContain('/kategori/ev')
    expect(paths).toContain('/kategori/ev/ev-mobilya')
    expect(paths).toContain('/kategori/ev/ev-mobilya/ev-mobilya-sehpa')
    // Productless sibling root stays out.
    expect(paths).not.toContain('/kategori/ofis')
  })

  it('falls back to the static sitemap when the DB is unreachable', async () => {
    prismaMock.category.findMany.mockRejectedValue(new Error('db down'))

    const entries = await sitemap()
    const paths = urlsOf(entries)

    // Static fallback ships the hardcoded launch categories.
    expect(paths).toContain('/kategori/mobilya')
    expect(paths).toContain('/')
  })
})
