import { describe, expect, it } from 'vitest'
import {
  resolveImportCategory,
  type CategoryNode,
} from '../../api/services/product-import/category-resolver'

const categories: CategoryNode[] = [
  { id: 'root-ev', name: 'Ev', parentId: null },
  { id: 'cat-mobilya', name: 'Mobilya', parentId: 'root-ev' },
  { id: 'cat-sehpa', name: 'Sehpa Modelleri', parentId: 'cat-mobilya' },
  { id: 'cat-kanepe', name: 'Kanepe', parentId: 'cat-mobilya' },
  { id: 'root-banyo', name: 'Banyo', parentId: null },
  { id: 'cat-aksesuar', name: 'Aksesuar', parentId: 'root-banyo' },
]

describe('resolveImportCategory', () => {
  it('empty path → rejected:empty_path', () => {
    expect(resolveImportCategory({ hipiconPath: [], categories })).toEqual({
      kind: 'rejected',
      reason: 'empty_path',
    })
  })

  it('root not in our tree → rejected:root_missing', () => {
    const result = resolveImportCategory({
      hipiconPath: ['Yaşam', 'Kedi-Pet', 'Mama Kabı'],
      categories,
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'root_missing' })
  })

  it('only root matches → rejected:too_shallow', () => {
    const result = resolveImportCategory({
      hipiconPath: ['Ev', 'Bilinmeyen'],
      categories,
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'too_shallow' })
  })

  it('full path matches exactly → matched', () => {
    const result = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Kanepe'],
      categories,
    })
    expect(result).toEqual({ kind: 'matched', categoryId: 'cat-kanepe' })
  })

  it('2-level match + 1 unknown leaf → auto_create_leaf', () => {
    const result = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa Modelleri'],
      categories,
    })
    expect(result).toEqual({
      kind: 'auto_create_leaf',
      parentId: 'cat-sehpa',
      leafName: 'Yan Sehpa Modelleri',
    })
  })

  it('2-level match + 2 unknown leaves → rejected:too_divergent', () => {
    const result = resolveImportCategory({
      hipiconPath: ['Banyo', 'Aksesuar', 'Sabunluk', 'Cam'],
      categories,
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'too_divergent' })
  })

  it('soft match: "Sehpa" matches "Sehpa Modelleri" → auto_create_leaf for sub', () => {
    // Hipicon: Ev / Mobilya / Sehpa / Yan Sehpa
    // Our tree: Ev / Mobilya / Sehpa Modelleri
    // matchDepth=3 (root Ev, Mobilya, Sehpa≈Sehpa Modelleri), 1 remaining
    const result = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya', 'Sehpa', 'Yan Sehpa'],
      categories,
    })
    expect(result).toEqual({
      kind: 'auto_create_leaf',
      parentId: 'cat-sehpa',
      leafName: 'Yan Sehpa',
    })
  })

  it('2-level path matches a non-leaf category → rejected:too_shallow', () => {
    // "Mobilya" has active children (Sehpa Modelleri, Kanepe) in our tree, so a
    // product cannot be attached to it directly — only leaf categories qualify.
    const result = resolveImportCategory({
      hipiconPath: ['Ev', 'Mobilya'],
      categories,
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'too_shallow' })
  })

  it('Turkish char normalization: "EV" root matches "Ev", but non-leaf match still rejected', () => {
    const result = resolveImportCategory({
      hipiconPath: ['EV', 'Mobilya'],
      categories,
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'too_shallow' })
  })

  it('full path matches a leaf category with only inactive-equivalent (no) children → matched', () => {
    // Sanity check: leaf matching still works when the tree has no deeper level.
    const result = resolveImportCategory({
      hipiconPath: ['Banyo', 'Aksesuar'],
      categories,
    })
    expect(result).toEqual({ kind: 'matched', categoryId: 'cat-aksesuar' })
  })
})
