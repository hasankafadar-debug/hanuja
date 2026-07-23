import { describe, expect, it } from 'vitest'
import {
  buildChildrenMap,
  getAncestorPath,
  isLeafCategory,
  type CategoryNode,
} from '../../apps/seller-panel/src/app/(panel)/urunler/_lib/category-tree'

// Mirrors the launch taxonomy shape: 2 roots -> mid level -> leaves.
// Order matches what listAllCategories() returns ([parentId asc, sortOrder asc]).
const categories: CategoryNode[] = [
  { id: 'ev', name: 'Ev', parentId: null },
  { id: 'ofis', name: 'Ofis', parentId: null },
  { id: 'ev-mobilya', name: 'Mobilya', parentId: 'ev' },
  { id: 'ev-aydinlatma', name: 'Aydınlatma', parentId: 'ev' },
  { id: 'ofis-mobilya', name: 'Mobilya', parentId: 'ofis' },
  { id: 'ev-mobilya-sehpa', name: 'Sehpa Modelleri', parentId: 'ev-mobilya' },
  { id: 'ev-mobilya-sehpa-orta', name: 'Orta Sehpa', parentId: 'ev-mobilya-sehpa' },
  { id: 'ev-mobilya-sehpa-yan', name: 'Yan Sehpa', parentId: 'ev-mobilya-sehpa' },
  { id: 'ev-mobilya-sehpa-zigon', name: 'Zigon Sehpa', parentId: 'ev-mobilya-sehpa' },
  { id: 'ev-mobilya-konsol', name: 'Konsol', parentId: 'ev-mobilya' },
]

describe('buildChildrenMap', () => {
  it('groups categories under their parent id', () => {
    const map = buildChildrenMap(categories)

    expect(map.get(null)?.map((node) => node.id)).toEqual(['ev', 'ofis'])
    expect(map.get('ev')?.map((node) => node.id)).toEqual(['ev-mobilya', 'ev-aydinlatma'])
    expect(map.get('ev-mobilya')?.map((node) => node.id)).toEqual([
      'ev-mobilya-sehpa',
      'ev-mobilya-konsol',
    ])
  })

  it('preserves input order so the server-side sortOrder is respected', () => {
    const reversed = [...categories].reverse()
    expect(buildChildrenMap(reversed).get('ev-mobilya')?.map((node) => node.id)).toEqual([
      'ev-mobilya-konsol',
      'ev-mobilya-sehpa',
    ])
  })

  it('returns no entry for a leaf category', () => {
    expect(buildChildrenMap(categories).get('ev-mobilya-sehpa-orta')).toBeUndefined()
  })
})

describe('getAncestorPath', () => {
  it('returns the chain from the root down to the given category', () => {
    expect(getAncestorPath('ev-mobilya-sehpa-orta', categories)).toEqual([
      'ev',
      'ev-mobilya',
      'ev-mobilya-sehpa',
      'ev-mobilya-sehpa-orta',
    ])
  })

  it('returns a single entry for a root category', () => {
    expect(getAncestorPath('ofis', categories)).toEqual(['ofis'])
  })

  it('returns an empty array for an unknown id', () => {
    expect(getAncestorPath('bilinmeyen', categories)).toEqual([])
    expect(getAncestorPath('', categories)).toEqual([])
  })

  it('stops instead of looping on a circular parent reference', () => {
    const circular: CategoryNode[] = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]

    expect(getAncestorPath('a', circular)).toEqual(['b', 'a'])
  })
})

describe('isLeafCategory', () => {
  it('treats categories without children as leaves', () => {
    expect(isLeafCategory('ev-mobilya-sehpa-orta', categories)).toBe(true)
    expect(isLeafCategory('ev-aydinlatma', categories)).toBe(true)
  })

  it('rejects root and intermediate categories', () => {
    expect(isLeafCategory('ev', categories)).toBe(false)
    expect(isLeafCategory('ev-mobilya', categories)).toBe(false)
    expect(isLeafCategory('ev-mobilya-sehpa', categories)).toBe(false)
  })
})
