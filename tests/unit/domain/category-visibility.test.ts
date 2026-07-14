import { describe, expect, it } from 'vitest'
import {
  computeCustomerVisibleCategoryIds,
  type CategoryVisibilityNode,
} from '../../../api/domain/category-visibility'

function node(id: string, parentId: string | null = null): CategoryVisibilityNode {
  return { id, parentId }
}

function counts(entries: Array<[string, number]>): Map<string, number> {
  return new Map(entries)
}

describe('computeCustomerVisibleCategoryIds', () => {
  const tree: CategoryVisibilityNode[] = [
    node('ev'),
    node('ev-mobilya', 'ev'),
    node('ev-mobilya-sehpa', 'ev-mobilya'),
    node('ev-mobilya-koltuk', 'ev-mobilya'),
    node('ev-dekorasyon', 'ev'),
    node('ofis'),
    node('ofis-mobilya', 'ofis'),
  ]

  it('returns empty set when no category has published products', () => {
    expect(computeCustomerVisibleCategoryIds(tree, counts([]))).toEqual(new Set())
  })

  it('makes a leaf and all its ancestors visible', () => {
    const visible = computeCustomerVisibleCategoryIds(
      tree,
      counts([['ev-mobilya-sehpa', 1]]),
    )
    expect(visible).toEqual(new Set(['ev-mobilya-sehpa', 'ev-mobilya', 'ev']))
  })

  it('keeps productless sibling subtrees hidden', () => {
    const visible = computeCustomerVisibleCategoryIds(
      tree,
      counts([['ev-mobilya-sehpa', 3]]),
    )
    expect(visible.has('ev-dekorasyon')).toBe(false)
    expect(visible.has('ofis')).toBe(false)
    expect(visible.has('ofis-mobilya')).toBe(false)
  })

  it('does not make children of a product-bearing mid-level node visible (roll-up is upward only)', () => {
    const visible = computeCustomerVisibleCategoryIds(tree, counts([['ev-mobilya', 2]]))
    expect(visible).toEqual(new Set(['ev-mobilya', 'ev']))
    expect(visible.has('ev-mobilya-sehpa')).toBe(false)
    expect(visible.has('ev-mobilya-koltuk')).toBe(false)
  })

  it('handles a multi-root forest independently', () => {
    const visible = computeCustomerVisibleCategoryIds(
      tree,
      counts([
        ['ev-mobilya-koltuk', 1],
        ['ofis-mobilya', 5],
      ]),
    )
    expect(visible).toEqual(
      new Set(['ev-mobilya-koltuk', 'ev-mobilya', 'ev', 'ofis-mobilya', 'ofis']),
    )
  })

  it('ignores counts for unknown or stale category ids', () => {
    const visible = computeCustomerVisibleCategoryIds(
      tree,
      counts([['deleted-category', 7]]),
    )
    expect(visible).toEqual(new Set())
  })

  it('ignores zero and negative counts', () => {
    const visible = computeCustomerVisibleCategoryIds(
      tree,
      counts([
        ['ev-mobilya', 0],
        ['ofis-mobilya', -1],
      ]),
    )
    expect(visible).toEqual(new Set())
  })

  it('does not hang on a parentId cycle', () => {
    const cyclic: CategoryVisibilityNode[] = [
      node('a', 'b'),
      node('b', 'a'),
    ]
    const visible = computeCustomerVisibleCategoryIds(cyclic, counts([['a', 1]]))
    expect(visible.has('a')).toBe(true)
    expect(visible.has('b')).toBe(true)
  })
})
