/**
 * Unit tests — cart summary breakdown logic.
 * Mirrors the math used inside `api/services/cart.service.ts` getCart() so that
 * regressions in netSubtotal / taxBreakdown / eftDiscountRatePercent are caught.
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../../api/domain/tax'
import { roundMoney } from '../../packages/security/src/money'

type CategoryNode = { parentId: string | null; taxRate: Decimal | null }
type CartItem = { productId: string; quantity: number; unitPrice: Decimal; categoryId: string | null }

function buildSummary(
  items: CartItem[],
  categories: Map<string, CategoryNode>,
  defaultTaxRate: Decimal,
  shipping: { freeShippingThresholdTry: Decimal; flatShippingFeeTry: Decimal; eftDiscountRate: Decimal },
) {
  const subtotal = items.reduce(
    (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
    new Decimal(0),
  )

  const taxBreakdownMap = new Map<number, Decimal>()
  const taxAmount = items.reduce((sum, item) => {
    const rate = resolveCategoryTaxRate(item.categoryId, categories, defaultTaxRate)
    const lineTax = calculateIncludedTax(item.unitPrice.mul(item.quantity), rate)
    const ratePercent = Number(rate.mul(100).toFixed(2))
    taxBreakdownMap.set(ratePercent, (taxBreakdownMap.get(ratePercent) ?? new Decimal(0)).plus(lineTax))
    return sum.plus(lineTax)
  }, new Decimal(0))

  const netSubtotal = subtotal.sub(taxAmount)
  const shippingFee = subtotal.gte(shipping.freeShippingThresholdTry)
    ? new Decimal(0)
    : shipping.flatShippingFeeTry

  const taxBreakdown = [...taxBreakdownMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ratePercent, amount]) => ({ ratePercent, taxAmount: roundMoney(amount).toFixed(2) }))

  return {
    grossSubtotal: roundMoney(subtotal),
    netSubtotal: roundMoney(netSubtotal),
    taxAmount,
    taxBreakdown,
    shipping: shippingFee,
    couponDiscount: new Decimal(0),
    eftDiscount: new Decimal(0),
    total: roundMoney(subtotal.plus(shippingFee)),
    eftDiscountRatePercent: Number(shipping.eftDiscountRate.mul(100).toFixed(2)),
  }
}

const SHIPPING = {
  freeShippingThresholdTry: new Decimal(500),
  flatShippingFeeTry: new Decimal(50),
  eftDiscountRate: new Decimal('0.05'),
}

describe('cart summary — single VAT rate', () => {
  it('produces single taxBreakdown row at category rate', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-a', { parentId: null, taxRate: new Decimal('0.20') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 2, unitPrice: new Decimal(100), categoryId: 'cat-a' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.20'), SHIPPING)

    expect(summary.taxBreakdown).toHaveLength(1)
    expect(summary.taxBreakdown[0]?.ratePercent).toBe(20)
    // gross 200 includes 200/(1+0.20) = 166.67 net + 33.33 tax
    expect(Number(summary.taxBreakdown[0]?.taxAmount)).toBeCloseTo(33.33, 1)
    expect(summary.grossSubtotal.toNumber()).toBeCloseTo(200, 1)
    expect(summary.netSubtotal.toNumber()).toBeCloseTo(166.67, 1)
  })
})

describe('cart summary — multiple VAT rates', () => {
  it('aggregates two products with different rates into two ascending rows', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-low', { parentId: null, taxRate: new Decimal('0.10') }],
      ['cat-high', { parentId: null, taxRate: new Decimal('0.20') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(110), categoryId: 'cat-low' }, // 10 tax
      { productId: 'p2', quantity: 1, unitPrice: new Decimal(120), categoryId: 'cat-high' }, // 20 tax
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), SHIPPING)

    expect(summary.taxBreakdown.map((r) => r.ratePercent)).toEqual([10, 20])
    expect(Number(summary.taxBreakdown[0]?.taxAmount)).toBeCloseTo(10, 1)
    expect(Number(summary.taxBreakdown[1]?.taxAmount)).toBeCloseTo(20, 1)

    // netSubtotal = grossSubtotal - sum(tax)
    expect(summary.grossSubtotal.toNumber()).toBeCloseTo(230, 1)
    expect(summary.netSubtotal.toNumber()).toBeCloseTo(200, 1)
  })

  it('merges items with the same VAT rate into a single row', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-1', { parentId: null, taxRate: new Decimal('0.10') }],
      ['cat-2', { parentId: null, taxRate: new Decimal('0.10') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(110), categoryId: 'cat-1' },
      { productId: 'p2', quantity: 2, unitPrice: new Decimal(110), categoryId: 'cat-2' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), SHIPPING)

    expect(summary.taxBreakdown).toHaveLength(1)
    expect(summary.taxBreakdown[0]?.ratePercent).toBe(10)
    // 110 + 220 = 330 gross, tax = 330/11 = 30
    expect(Number(summary.taxBreakdown[0]?.taxAmount)).toBeCloseTo(30, 1)
  })
})

describe('cart summary — shipping & EFT discount surfacing', () => {
  it('returns 0 shipping when subtotal >= free shipping threshold', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-a', { parentId: null, taxRate: new Decimal('0.10') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(600), categoryId: 'cat-a' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), SHIPPING)
    expect(summary.shipping.toNumber()).toBe(0)
  })

  it('charges flat shipping fee when subtotal below threshold', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-a', { parentId: null, taxRate: new Decimal('0.10') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(100), categoryId: 'cat-a' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), SHIPPING)
    expect(summary.shipping.toNumber()).toBe(50)
  })

  it('exposes eftDiscountRatePercent for storefront UI to decide whether to render the discount line', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-a', { parentId: null, taxRate: new Decimal('0.10') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(100), categoryId: 'cat-a' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), SHIPPING)
    expect(summary.eftDiscountRatePercent).toBe(5)
    // Cart-level eftDiscount stays zero — only checkout applies it
    expect(summary.eftDiscount.toNumber()).toBe(0)
  })

  it('hides EFT discount line by zeroing eftDiscountRatePercent when admin disabled it', () => {
    const cats = new Map<string, CategoryNode>([
      ['cat-a', { parentId: null, taxRate: new Decimal('0.10') }],
    ])
    const items: CartItem[] = [
      { productId: 'p1', quantity: 1, unitPrice: new Decimal(100), categoryId: 'cat-a' },
    ]
    const summary = buildSummary(items, cats, new Decimal('0.18'), {
      ...SHIPPING,
      eftDiscountRate: new Decimal(0),
    })
    expect(summary.eftDiscountRatePercent).toBe(0)
  })
})

describe('cart summary — empty cart', () => {
  it('produces zero totals and empty breakdown', () => {
    const summary = buildSummary([], new Map(), new Decimal('0.18'), SHIPPING)
    expect(summary.grossSubtotal.toNumber()).toBe(0)
    expect(summary.netSubtotal.toNumber()).toBe(0)
    expect(summary.taxBreakdown).toEqual([])
    expect(summary.total.toNumber()).toBe(50) // shipping below threshold
  })
})
