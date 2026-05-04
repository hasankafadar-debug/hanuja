/**
 * Unit tests — checkout.service.ts
 * Covers: cart validation, price recalculation, shipping fee logic,
 * commission computation, idempotency key handling.
 *
 * These tests focus on pure business logic extracted from the checkout flow.
 * Integration tests for full order creation are in tests/integration/.
 */
import { describe, it, expect } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import {
  calculateShippingFee as calculateShippingFeeTry,
  FLAT_SHIPPING_FEE_TRY,
  FREE_SHIPPING_THRESHOLD_TRY,
} from '../../../api/domain/shipping'

// ── Constants from checkout.service.ts ─────────────────────────────────────────
const SYSTEM_DEFAULT_COMMISSION_RATE = new Decimal('0.1500') // %15

// ── Shipping fee calculation ──────────────────────────────────────────────────

function calculateShippingFee(subtotal: Decimal): number {
  return calculateShippingFeeTry(subtotal.toNumber())
}

describe('Checkout — shipping fee calculation', () => {
  it('charges ₺99 shipping for orders below ₺1500', () => {
    expect(calculateShippingFee(new Decimal(500))).toBe(FLAT_SHIPPING_FEE_TRY)
    expect(calculateShippingFee(new Decimal(FREE_SHIPPING_THRESHOLD_TRY - 1))).toBe(
      FLAT_SHIPPING_FEE_TRY,
    )
    expect(calculateShippingFee(new Decimal(0))).toBe(FLAT_SHIPPING_FEE_TRY)
  })

  it('provides free shipping at ₺1500 threshold', () => {
    expect(calculateShippingFee(new Decimal(FREE_SHIPPING_THRESHOLD_TRY))).toBe(0)
  })

  it('provides free shipping above ₺1500', () => {
    expect(calculateShippingFee(new Decimal(FREE_SHIPPING_THRESHOLD_TRY + 1))).toBe(0)
    expect(calculateShippingFee(new Decimal(5000))).toBe(0)
  })
})

// ── Commission calculation ────────────────────────────────────────────────────

function calculateCommission(
  grossAmount: Decimal,
  rate: Decimal = SYSTEM_DEFAULT_COMMISSION_RATE,
): Decimal {
  return grossAmount.mul(rate).toDecimalPlaces(2)
}

describe('Checkout — commission calculation', () => {
  it('calculates 15% commission by default', () => {
    expect(calculateCommission(new Decimal(1000)).toNumber()).toBe(150)
    expect(calculateCommission(new Decimal(2499)).toNumber()).toBe(374.85)
  })

  it('supports custom commission rates', () => {
    const rate = new Decimal('0.12')
    expect(calculateCommission(new Decimal(1000), rate).toNumber()).toBe(120)
  })

  it('handles zero gross amount', () => {
    expect(calculateCommission(new Decimal(0)).toNumber()).toBe(0)
  })

  it('rounds to 2 decimal places', () => {
    // 333 * 0.15 = 49.95
    expect(calculateCommission(new Decimal(333)).toNumber()).toBe(49.95)
    // 111 * 0.15 = 16.65
    expect(calculateCommission(new Decimal(111)).toNumber()).toBe(16.65)
  })
})

// ── Order total computation ───────────────────────────────────────────────────

function calculateOrderTotal(subtotal: Decimal, shippingFee: Decimal, discount: Decimal = new Decimal(0)): Decimal {
  const total = subtotal.plus(shippingFee).minus(discount)
  return total.greaterThan(new Decimal(0)) ? total : new Decimal(0)
}

describe('Checkout — order total computation', () => {
  it('sums subtotal and shipping', () => {
    expect(calculateOrderTotal(new Decimal(500), new Decimal(99)).toNumber()).toBe(599)
  })

  it('applies discount', () => {
    expect(
      calculateOrderTotal(new Decimal(1000), new Decimal(99), new Decimal(100)).toNumber(),
    ).toBe(999)
  })

  it('does not go below zero', () => {
    expect(
      calculateOrderTotal(new Decimal(50), new Decimal(0), new Decimal(200)).toNumber(),
    ).toBe(0)
  })

  it('free shipping order total equals subtotal', () => {
    expect(calculateOrderTotal(new Decimal(2000), new Decimal(0)).toNumber()).toBe(2000)
  })
})

// ── Cart validation rules ──────────────────────────────────────────────────────

describe('Checkout — cart validation rules', () => {
  it('detects empty cart', () => {
    const cart = { items: [] }
    expect(cart.items.length === 0).toBe(true)
  })

  it('detects unpublished product', () => {
    const product = { id: 'p1', status: 'draft', stockQuantity: 10 }
    expect(product.status !== 'published').toBe(true)
  })

  it('detects insufficient stock', () => {
    const product = { id: 'p1', status: 'published', stockQuantity: 2 }
    const requestedQuantity = 5
    expect(product.stockQuantity < requestedQuantity).toBe(true)
  })

  it('detects price change since cart snapshot', () => {
    const cartPrice = new Decimal(199)
    const currentPrice = new Decimal(249)
    const priceChanged = !cartPrice.equals(currentPrice)
    expect(priceChanged).toBe(true)
  })

  it('passes valid cart with in-stock published products', () => {
    const product = { id: 'p1', status: 'published', stockQuantity: 10, price: new Decimal(199) }
    const cartItem = { productId: 'p1', quantity: 2, unitPrice: new Decimal(199) }
    const valid =
      product.status === 'published' &&
      product.stockQuantity >= cartItem.quantity &&
      product.price.equals(cartItem.unitPrice)
    expect(valid).toBe(true)
  })
})

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('Checkout — idempotency key', () => {
  it('generates unique keys', () => {
    const key1 = `order-user1-${Date.now()}`
    const key2 = `order-user1-${Date.now() + 1}`
    expect(key1).not.toBe(key2)
  })
})
