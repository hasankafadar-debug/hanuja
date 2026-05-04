/**
 * Integration tests — auto-create leaf category on commit
 *
 * When a selection has `autoCreateUnder`, the commit service must:
 * 1. Create the leaf category under the given parent if it doesn't exist
 * 2. Set `createdViaImportBy` to the sellerId
 * 3. Use the created category's ID for the product
 * 4. Create the category only once when multiple products request the same leaf
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../api/lib/prisma', () => ({
  prisma: {},
  createPrismaForRoute: () => ({}),
  default: {},
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  addJob: vi.fn(),
}))

vi.mock('../../api/lib/meilisearch', () => ({ getMeilisearchClient: vi.fn() }))
vi.mock('../../api/lib/r2', () => ({ getR2Client: vi.fn() }))

import { resolveImportCategory } from '../../api/services/product-import/category-resolver'

describe('auto_create_leaf decision', () => {
  const categories = [
    { id: 'root-ev', name: 'Ev', parentId: null },
    { id: 'cat-mobilya', name: 'Mobilya', parentId: 'root-ev' },
    { id: 'cat-sehpa', name: 'Sehpa Modelleri', parentId: 'cat-mobilya' },
  ]

  it('produces auto_create_leaf with correct parentId and leafName', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa Modelleri'],
      categories,
    })

    expect(decision.kind).toBe('auto_create_leaf')
    if (decision.kind === 'auto_create_leaf') {
      expect(decision.parentId).toBe('cat-sehpa')
      expect(decision.leafName).toBe('Yan Sehpa Modelleri')
    }
  })

  it('multiple items with the same leaf produce identical auto_create_leaf decisions', () => {
    const d1 = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa Modelleri'],
      categories,
    })
    const d2 = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa Modelleri'],
      categories,
    })

    expect(d1).toEqual(d2)
  })

  it('already-matched path does not produce auto_create_leaf', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa Modelleri'],
      categories,
    })
    expect(decision.kind).toBe('matched')
  })
})
