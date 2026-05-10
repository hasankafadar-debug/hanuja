/**
 * Unit tests — tax domain helpers.
 * Covers resolveCategoryTaxRate hierarchical fallback and calculateIncludedTax.
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../../api/domain/tax'

type CatNode = { parentId: string | null; taxRate: Decimal | null }

function buildCategoryMap(entries: Array<[string, CatNode]>) {
  return new Map<string, CatNode>(entries)
}

describe('resolveCategoryTaxRate', () => {
  const defaultRate = new Decimal('0.20')

  it('returns category own taxRate when present', () => {
    const map = buildCategoryMap([['c1', { parentId: null, taxRate: new Decimal('0.10') }]])
    expect(resolveCategoryTaxRate('c1', map, defaultRate).toNumber()).toBeCloseTo(0.1, 4)
  })

  it('walks up to parent when leaf taxRate is null', () => {
    const map = buildCategoryMap([
      ['child', { parentId: 'parent', taxRate: null }],
      ['parent', { parentId: null, taxRate: new Decimal('0.18') }],
    ])
    expect(resolveCategoryTaxRate('child', map, defaultRate).toNumber()).toBeCloseTo(0.18, 4)
  })

  it('walks up two levels when intermediate is also null', () => {
    const map = buildCategoryMap([
      ['leaf', { parentId: 'mid', taxRate: null }],
      ['mid', { parentId: 'root', taxRate: null }],
      ['root', { parentId: null, taxRate: new Decimal('0.08') }],
    ])
    expect(resolveCategoryTaxRate('leaf', map, defaultRate).toNumber()).toBeCloseTo(0.08, 4)
  })

  it('falls back to defaultTaxRate when entire chain is null', () => {
    const map = buildCategoryMap([
      ['leaf', { parentId: 'root', taxRate: null }],
      ['root', { parentId: null, taxRate: null }],
    ])
    expect(resolveCategoryTaxRate('leaf', map, defaultRate).toNumber()).toBeCloseTo(0.2, 4)
  })

  it('falls back to defaultTaxRate when categoryId is null', () => {
    const map = buildCategoryMap([])
    expect(resolveCategoryTaxRate(null, map, defaultRate).toNumber()).toBeCloseTo(0.2, 4)
  })

  it('falls back to defaultTaxRate when categoryId is unknown', () => {
    const map = buildCategoryMap([['known', { parentId: null, taxRate: new Decimal('0.10') }]])
    expect(resolveCategoryTaxRate('missing', map, defaultRate).toNumber()).toBeCloseTo(0.2, 4)
  })

  it('does not infinite-loop on cyclic parent reference', () => {
    const map = buildCategoryMap([
      ['a', { parentId: 'b', taxRate: null }],
      ['b', { parentId: 'a', taxRate: null }],
    ])
    expect(resolveCategoryTaxRate('a', map, defaultRate).toNumber()).toBeCloseTo(0.2, 4)
  })

  it('returns first non-null ancestor (does not skip ancestors above)', () => {
    const map = buildCategoryMap([
      ['leaf', { parentId: 'mid', taxRate: null }],
      ['mid', { parentId: 'root', taxRate: new Decimal('0.10') }],
      ['root', { parentId: null, taxRate: new Decimal('0.20') }],
    ])
    expect(resolveCategoryTaxRate('leaf', map, defaultRate).toNumber()).toBeCloseTo(0.1, 4)
  })
})

describe('calculateIncludedTax', () => {
  it('extracts 18% VAT included in gross amount', () => {
    const gross = new Decimal(118)
    const rate = new Decimal('0.18')
    expect(calculateIncludedTax(gross, rate).toNumber()).toBeCloseTo(18, 1)
  })

  it('returns 0 when gross is 0', () => {
    expect(calculateIncludedTax(new Decimal(0), new Decimal('0.18')).toNumber()).toBe(0)
  })

  it('returns 0 when rate is 0', () => {
    expect(calculateIncludedTax(new Decimal(100), new Decimal(0)).toNumber()).toBe(0)
  })

  it('returns 0 when gross is negative', () => {
    expect(calculateIncludedTax(new Decimal(-50), new Decimal('0.18')).toNumber()).toBe(0)
  })
})
