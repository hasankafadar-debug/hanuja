import { describe, expect, it } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  applyEffectivePricing,
  buildPriceKeySources,
  computeEffectivePrice,
  deriveRuleStatus,
  ruleBoundaryInstants,
  type DiscountRuleLike,
} from '../../../api/domain/effective-price'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const product = {
  id: 'p1',
  sellerId: 's1',
  categoryId: 'c1',
  price: new Decimal(1000),
  compareAtPrice: null,
}

function rule(overrides: Partial<DiscountRuleLike>): DiscountRuleLike {
  return {
    id: 'r',
    name: 'Kural',
    sellerId: 's1',
    scope: 'ALL_PRODUCTS',
    type: 'PERCENT',
    value: new Decimal(10),
    categoryId: null,
    status: 'ACTIVE',
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    products: [],
    ...overrides,
  }
}

describe('deriveRuleStatus', () => {
  it('follows the clock for ACTIVE/SCHEDULED rules and keeps PAUSED/EXPIRED', () => {
    const start = new Date('2026-10-01T12:00:00.000Z')
    const end = new Date('2026-10-02T12:00:00.000Z')
    expect(deriveRuleStatus({ status: 'SCHEDULED', startsAt: start, endsAt: end }, new Date(start.getTime() - 1))).toBe('SCHEDULED')
    expect(deriveRuleStatus({ status: 'SCHEDULED', startsAt: start, endsAt: end }, start)).toBe('ACTIVE')
    expect(deriveRuleStatus({ status: 'ACTIVE', startsAt: start, endsAt: end }, end)).toBe('ACTIVE')
    expect(deriveRuleStatus({ status: 'ACTIVE', startsAt: start, endsAt: end }, new Date(end.getTime() + 1))).toBe('EXPIRED')
    expect(deriveRuleStatus({ status: 'PAUSED', startsAt: null, endsAt: null }, NOW)).toBe('PAUSED')
  })
})

describe('applyEffectivePricing (cart/checkout/product page)', () => {
  it('applies the product rule to a variant base price exactly as the cart did', () => {
    const pricing = computeEffectivePrice(product, [rule({})], NOW)
    // Same arithmetic as the former cart.service helper: base × (100 − v) / 100, 2 decimals.
    expect(applyEffectivePricing(new Decimal(1249.99), pricing).toString()).toBe('1124.99')
    expect(applyEffectivePricing(new Decimal(1000), pricing).toString()).toBe('900')
  })

  it('returns the base price unchanged when no rule applies', () => {
    const pricing = computeEffectivePrice(product, [], NOW)
    expect(applyEffectivePricing(new Decimal(123.45), pricing).toString()).toBe('123.45')
  })

  it('never goes below zero for a fixed amount larger than the base', () => {
    const pricing = computeEffectivePrice(product, [rule({ type: 'FIXED_AMOUNT', value: new Decimal(5000) })], NOW)
    expect(applyEffectivePricing(new Decimal(300), pricing).toString()).toBe('0')
  })

  it('PRODUCT scope wins over CATEGORY and ALL_PRODUCTS even when those are deeper', () => {
    const rules = [
      rule({ id: 'all', value: new Decimal(50) }),
      rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'c1', value: new Decimal(30) }),
      rule({ id: 'prod', scope: 'PRODUCT', value: new Decimal(5), products: [{ productId: 'p1' }] }),
    ]
    const pricing = computeEffectivePrice(product, rules, NOW)
    expect(pricing.discountSource?.ruleId).toBe('prod')
    expect(pricing.effectivePrice.toString()).toBe('950')
  })
})

describe('price keys', () => {
  it('a product without variants is one key; with variants each variant is a key', () => {
    expect(buildPriceKeySources({ id: 'p1', price: new Decimal(10), stockQuantity: 3 }, [])).toEqual([
      expect.objectContaining({ priceKey: 'product:p1', variantId: null, stockQuantity: 3 }),
    ])
    const keys = buildPriceKeySources({ id: 'p1', price: new Decimal(10), stockQuantity: 3 }, [
      { id: 'v1', price: null, stockQuantity: 1 },
      { id: 'v2', price: new Decimal(12), stockQuantity: 0 },
    ])
    expect(keys.map((key) => [key.priceKey, key.basePrice.toString(), key.stockQuantity])).toEqual([
      ['variant:v1', '10', 1],
      ['variant:v2', '12', 0],
    ])
  })
})

describe('ruleBoundaryInstants', () => {
  it('returns future start and end+1ms instants, skipping PAUSED/EXPIRED rules', () => {
    const start = new Date('2026-10-02T00:00:00.000Z')
    const end = new Date('2026-10-02T00:10:00.000Z')
    const instants = ruleBoundaryInstants(
      [
        rule({ status: 'SCHEDULED', startsAt: start, endsAt: end }),
        rule({ id: 'paused', status: 'PAUSED', startsAt: start, endsAt: end }),
        rule({ id: 'past', startsAt: new Date('2026-09-01T00:00:00.000Z'), endsAt: null }),
      ],
      NOW,
    )
    expect(instants.map((instant) => instant.toISOString())).toEqual([
      '2026-10-02T00:00:00.000Z',
      '2026-10-02T00:10:00.001Z',
    ])
  })
})
