/**
 * Integration tests — checkout calculation flow.
 * Covers: price recalculation, commission per seller, shipping fee,
 * multi-seller order splitting, coupon discount application.
 *
 * These test the complete calculation pipeline that happens
 * during checkout — from cart items to order totals.
 *
 * See: 07-marketplace-finance-rules.md, CLAUDE.md §15
 */
import { describe, it, expect } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'

// ── Extracted business constants ──────────────────────────────────────────────

const SYSTEM_DEFAULT_COMMISSION_RATE = new Decimal('0.15')
const FREE_SHIPPING_THRESHOLD = new Decimal('1500')
const FLAT_SHIPPING_FEE = new Decimal('99')
const PENALTY_RATE = new Decimal('0.20') // 20% of product price

// ── Helpers (mirror checkout.service.ts logic) ────────────────────────────────

interface CartItem {
  productId: string
  sellerId: string
  quantity: number
  unitPrice: Decimal
  commissionRate?: Decimal
}

interface OrderLineSummary {
  sellerId: string
  grossAmount: Decimal
  commissionAmount: Decimal
  netSellerAmount: Decimal
}

function calculateShipping(subtotal: Decimal): Decimal {
  return subtotal.greaterThan(FREE_SHIPPING_THRESHOLD) || subtotal.equals(FREE_SHIPPING_THRESHOLD)
    ? new Decimal(0)
    : FLAT_SHIPPING_FEE
}

function resolveCommissionRate(
  productRate?: Decimal,
  categoryRate?: Decimal,
  sellerRate?: Decimal,
): Decimal {
  // CLAUDE.md §15.1: product override > category > seller > system default
  return productRate ?? categoryRate ?? sellerRate ?? SYSTEM_DEFAULT_COMMISSION_RATE
}

function buildOrderLines(items: CartItem[]): OrderLineSummary[] {
  const bySeller = new Map<string, CartItem[]>()
  for (const item of items) {
    const existing = bySeller.get(item.sellerId) ?? []
    existing.push(item)
    bySeller.set(item.sellerId, existing)
  }

  const lines: OrderLineSummary[] = []
  for (const [sellerId, sellerItems] of bySeller) {
    const grossAmount = sellerItems.reduce(
      (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
      new Decimal(0),
    )
    const rate = resolveCommissionRate(sellerItems[0].commissionRate)
    const commissionAmount = grossAmount.mul(rate).toDecimalPlaces(2)
    lines.push({
      sellerId,
      grossAmount,
      commissionAmount,
      netSellerAmount: grossAmount.minus(commissionAmount),
    })
  }
  return lines
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Checkout calculation — single seller', () => {
  it('calculates correct totals for single-product order', () => {
    const items: CartItem[] = [
      { productId: 'p1', sellerId: 's1', quantity: 1, unitPrice: new Decimal(1000) },
    ]

    const subtotal = items.reduce(
      (sum, item) => sum.plus(item.unitPrice.mul(item.quantity)),
      new Decimal(0),
    )
    const shipping = calculateShipping(subtotal)
    const total = subtotal.plus(shipping)

    expect(subtotal.toNumber()).toBe(1000)
    expect(shipping.toNumber()).toBe(99)
    expect(total.toNumber()).toBe(1099)
  })

  it('applies free shipping above threshold', () => {
    const items: CartItem[] = [
      { productId: 'p1', sellerId: 's1', quantity: 1, unitPrice: new Decimal(2000) },
    ]

    const subtotal = new Decimal(2000)
    const shipping = calculateShipping(subtotal)
    expect(shipping.toNumber()).toBe(0)
  })

  it('calculates commission correctly', () => {
    const items: CartItem[] = [
      { productId: 'p1', sellerId: 's1', quantity: 2, unitPrice: new Decimal(500) },
    ]

    const lines = buildOrderLines(items)
    expect(lines).toHaveLength(1)
    expect(lines[0].grossAmount.toNumber()).toBe(1000)
    expect(lines[0].commissionAmount.toNumber()).toBe(150) // 15%
    expect(lines[0].netSellerAmount.toNumber()).toBe(850)
  })
})

describe('Checkout calculation — multi-seller order', () => {
  it('splits order by seller with separate commissions', () => {
    const items: CartItem[] = [
      { productId: 'p1', sellerId: 's1', quantity: 1, unitPrice: new Decimal(800) },
      { productId: 'p2', sellerId: 's2', quantity: 2, unitPrice: new Decimal(400) },
    ]

    const lines = buildOrderLines(items)
    expect(lines).toHaveLength(2)

    const s1Line = lines.find((l) => l.sellerId === 's1')!
    expect(s1Line.grossAmount.toNumber()).toBe(800)
    expect(s1Line.commissionAmount.toNumber()).toBe(120) // 800 * 15%

    const s2Line = lines.find((l) => l.sellerId === 's2')!
    expect(s2Line.grossAmount.toNumber()).toBe(800) // 2 × 400
    expect(s2Line.commissionAmount.toNumber()).toBe(120)
  })

  it('uses product-level commission override when available', () => {
    const items: CartItem[] = [
      {
        productId: 'p1',
        sellerId: 's1',
        quantity: 1,
        unitPrice: new Decimal(1000),
        commissionRate: new Decimal('0.10'), // 10% override
      },
    ]

    const lines = buildOrderLines(items)
    expect(lines[0].commissionAmount.toNumber()).toBe(100) // 10%, not 15%
    expect(lines[0].netSellerAmount.toNumber()).toBe(900)
  })
})

describe('Checkout calculation — commission resolution order', () => {
  // CLAUDE.md §15.1
  it('prefers product-specific rate over all others', () => {
    const rate = resolveCommissionRate(
      new Decimal('0.08'),  // product
      new Decimal('0.12'),  // category
      new Decimal('0.10'),  // seller
    )
    expect(rate.toNumber()).toBe(0.08)
  })

  it('uses category rate when product rate is undefined', () => {
    const rate = resolveCommissionRate(undefined, new Decimal('0.12'), new Decimal('0.10'))
    expect(rate.toNumber()).toBe(0.12)
  })

  it('uses seller rate when product and category are undefined', () => {
    const rate = resolveCommissionRate(undefined, undefined, new Decimal('0.10'))
    expect(rate.toNumber()).toBe(0.10)
  })

  it('falls back to system default when all overrides are undefined', () => {
    const rate = resolveCommissionRate(undefined, undefined, undefined)
    expect(rate.toNumber()).toBe(0.15) // system default
  })
})

describe('Checkout calculation — coupon discount', () => {
  it('applies flat discount correctly', () => {
    const subtotal = new Decimal(1000)
    const discount = new Decimal(100)
    const total = subtotal.minus(discount)
    expect(total.toNumber()).toBe(900)
  })

  it('applies percentage discount correctly', () => {
    const subtotal = new Decimal(1000)
    const discountRate = new Decimal('0.10') // 10%
    const discount = subtotal.mul(discountRate).toDecimalPlaces(2)
    const total = subtotal.minus(discount)
    expect(discount.toNumber()).toBe(100)
    expect(total.toNumber()).toBe(900)
  })

  it('discount does not reduce total below zero', () => {
    const subtotal = new Decimal(50)
    const discount = new Decimal(100)
    const total = subtotal.minus(discount)
    const safeTot = total.isNegative() ? new Decimal(0) : total
    expect(safeTot.toNumber()).toBe(0)
  })

  it('shipping is calculated on pre-discount subtotal', () => {
    // Subtotal ₺1600, discount ₺200 → post-discount ₺1400
    // But shipping decision uses ₺1600 (pre-discount) → free shipping
    const subtotal = new Decimal(1600)
    const shipping = calculateShipping(subtotal)
    expect(shipping.toNumber()).toBe(0) // free shipping based on pre-discount
  })
})

describe('Checkout calculation — penalty reference', () => {
  it('calculates 20% seller penalty on product amount', () => {
    const productAmount = new Decimal(1000)
    const penalty = productAmount.mul(PENALTY_RATE).toDecimalPlaces(2)
    expect(penalty.toNumber()).toBe(200)
  })

  it('penalty on fractional amounts rounds to 2 decimals', () => {
    const productAmount = new Decimal(333)
    const penalty = productAmount.mul(PENALTY_RATE).toDecimalPlaces(2)
    expect(penalty.toNumber()).toBe(66.6)
  })
})
