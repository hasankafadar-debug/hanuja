import { describe, expect, it } from 'vitest'
import { assertLeafCategory, isLeafCategory } from '../../api/domain/category-selection'
import { ValidationError } from '../../api/lib/errors'

describe('leaf category rule', () => {
  it('accepts a category with no children', () => {
    expect(isLeafCategory({ children: [] })).toBe(true)
    expect(() => assertLeafCategory({ children: [] })).not.toThrow()
  })

  it('rejects a category that still has an active child', () => {
    const intermediate = { children: [{ isActive: true }] }

    expect(isLeafCategory(intermediate)).toBe(false)
    expect(() => assertLeafCategory(intermediate)).toThrow(ValidationError)
    expect(() => assertLeafCategory(intermediate)).toThrow(
      'Ürün yalnızca en alt seviye kategoriye eklenebilir.',
    )
  })

  it('treats a category whose children are all inactive as a leaf', () => {
    const retiredBranch = { children: [{ isActive: false }, { isActive: false }] }

    expect(isLeafCategory(retiredBranch)).toBe(true)
    expect(() => assertLeafCategory(retiredBranch)).not.toThrow()
  })

  it('rejects when at least one child among many is active', () => {
    expect(() =>
      assertLeafCategory({ children: [{ isActive: false }, { isActive: true }] }),
    ).toThrow(ValidationError)
  })
})
