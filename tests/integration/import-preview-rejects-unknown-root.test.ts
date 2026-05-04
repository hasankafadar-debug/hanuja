/**
 * Integration tests — preview filters out items with unknown root categories
 *
 * When a Hipicon item's category path has a root segment that doesn't exist
 * in our category tree, it must appear in `rejected` and not in `items`.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveImportCategory } from '../../api/services/product-import/category-resolver'

vi.mock('../../api/lib/prisma', () => ({
  prisma: {},
  createPrismaForRoute: () => ({}),
  default: {},
}))

vi.mock('../../api/lib/queue', () => ({
  getQueue: vi.fn(),
  addJob: vi.fn(),
}))

const ourCategories = [
  { id: 'root-ev', name: 'Ev', parentId: null },
  { id: 'cat-mobilya', name: 'Mobilya', parentId: 'root-ev' },
  { id: 'cat-sehpa', name: 'Sehpa Modelleri', parentId: 'cat-mobilya' },
]

describe('resolveImportCategory — preview category filtering', () => {
  it('item with unknown root category is rejected (root_missing)', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Yaşam', 'Kedi-Pet', 'Mama Kabı'],
      categories: ourCategories,
    })
    expect(decision.kind).toBe('rejected')
    expect(decision.kind === 'rejected' && decision.reason).toBe('root_missing')
  })

  it('item with matching root but missing L2 is rejected (too_shallow)', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'BilinmeyenAlt'],
      categories: ourCategories,
    })
    expect(decision.kind).toBe('rejected')
    expect(decision.kind === 'rejected' && decision.reason).toBe('too_shallow')
  })

  it('item with full match is not rejected', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa Modelleri'],
      categories: ourCategories,
    })
    expect(decision.kind).toBe('matched')
  })

  it('item with 2-level match + 1 extra leaf → auto_create (not rejected)', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa'],
      categories: ourCategories,
    })
    expect(decision.kind).toBe('auto_create_leaf')
  })

  it('item with 2-level match + 2+ extra leaves → too_divergent', () => {
    const decision = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa', 'Mini'],
      categories: ourCategories,
    })
    expect(decision.kind).toBe('rejected')
    expect(decision.kind === 'rejected' && decision.reason).toBe('too_divergent')
  })
})
