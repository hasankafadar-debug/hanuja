/**
 * Security tests — seller must not receive order-level (customer-side) amounts.
 *
 * Sellers may only see amounts derived from their own order lines. Order-level
 * fields (Order.totalAmount, discountAmount, eftDiscountAmount,
 * eftDiscountRateSnapshot, grossAmount, shippingAmount, couponCode,
 * netSubtotal, taxBreakdownJson) reflect the customer's full order — other
 * sellers' lines, shipping, platform coupon, EFT channel discount, and the
 * admin EFT-approval discount — all platform-absorbed and irrelevant (and
 * partly not owned by) the seller.
 *
 * 07-marketplace-finance-rules.md, 09-seller-panel-rules.md
 */
import { describe, it, expect } from 'vitest'
import {
  toSellerSafeOrderDto,
  toSellerSafeOrderDtos,
  calculateSellerOrderLinesTotal,
  buildSellerOrderCsv,
} from '../../api/lib/seller-order-projection'

const ORDER_LEVEL_FINANCE_FIELDS = [
  'totalAmount',
  'discountAmount',
  'eftDiscountAmount',
  'eftDiscountRateSnapshot',
  'grossAmount',
  'shippingAmount',
  'couponCode',
  'netSubtotal',
  'taxBreakdownJson',
] as const

function makeRawOrder() {
  return {
    id: 'order_1',
    publicNumber: 26050001,
    status: 'seller_queue_ready',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    // Order-level fields that must never reach the seller:
    totalAmount: 58700,
    discountAmount: 1200,
    eftDiscountAmount: 1761,
    eftDiscountRateSnapshot: 0.03,
    grossAmount: 60000,
    shippingAmount: 0,
    couponCode: 'HOSGELDIN10',
    netSubtotal: 56939,
    taxBreakdownJson: { '0.20': 9500 },
    // Seller-owned fields that must survive the projection:
    lines: [
      { quantity: 2, unitPrice: 100, product: { name: 'Sehpa' } },
      { quantity: 1, unitPrice: 50, product: { name: 'Lamba' } },
    ],
    customer: { name: 'Ahmet Yılmaz', email: 'ahmet@example.com' },
  }
}

describe('toSellerSafeOrderDto — strips order-level customer-side amounts', () => {
  it('removes every order-level finance field', () => {
    const dto = toSellerSafeOrderDto(makeRawOrder())
    for (const field of ORDER_LEVEL_FINANCE_FIELDS) {
      expect(dto).not.toHaveProperty(field)
    }
  })

  it('preserves seller-owned fields (lines, id, status)', () => {
    const dto = toSellerSafeOrderDto(makeRawOrder())
    expect(dto.id).toBe('order_1')
    expect(dto.status).toBe('seller_queue_ready')
    expect(dto.lines).toHaveLength(2)
  })

  it('still masks customer name and strips email (existing behavior preserved)', () => {
    const dto = toSellerSafeOrderDto(makeRawOrder())
    expect(dto.customer?.name).toBe('Ahmet Y.')
    expect(dto.customer).not.toHaveProperty('email')
  })

  it('handles orders without a customer', () => {
    const raw = { ...makeRawOrder(), customer: null }
    const dto = toSellerSafeOrderDto(raw)
    expect(dto.customer).toBeNull()
    for (const field of ORDER_LEVEL_FINANCE_FIELDS) {
      expect(dto).not.toHaveProperty(field)
    }
  })

  it('toSellerSafeOrderDtos strips order-level fields for every row', () => {
    const dtos = toSellerSafeOrderDtos([makeRawOrder(), makeRawOrder()])
    for (const dto of dtos) {
      for (const field of ORDER_LEVEL_FINANCE_FIELDS) {
        expect(dto).not.toHaveProperty(field)
      }
    }
  })
})

describe('calculateSellerOrderLinesTotal — seller-safe total definition', () => {
  it('sums unit price × quantity across the seller-owned lines only', () => {
    const total = calculateSellerOrderLinesTotal([
      { quantity: 2, unitPrice: 100 },
      { quantity: 1, unitPrice: 50 },
    ])
    expect(total).toBe(250)
  })

  it('ignores Order.totalAmount entirely — never falls back to it', () => {
    const raw = makeRawOrder()
    const total = calculateSellerOrderLinesTotal(raw.lines)
    // 2*100 + 1*50 = 250, far below the customer-facing totalAmount (58700),
    // which includes other sellers' lines / shipping / discounts.
    expect(total).toBe(250)
    expect(total).not.toBe(raw.totalAmount)
  })

  it('supports Decimal-like values via toNumber()', () => {
    const total = calculateSellerOrderLinesTotal([
      { quantity: 3, unitPrice: { toNumber: () => 20 } },
    ])
    expect(total).toBe(60)
  })
})

describe('buildSellerOrderCsv — CSV export uses the same seller-safe total', () => {
  it('computes the exported total from lines, matching calculateSellerOrderLinesTotal', () => {
    const dto = toSellerSafeOrderDto(makeRawOrder())
    const csv = buildSellerOrderCsv([dto])
    const expectedTotal = calculateSellerOrderLinesTotal(dto.lines)
    expect(csv).toContain(`${expectedTotal} TL`)
    expect(csv).not.toContain('58700 TL')
  })
})
