import { describe, expect, it } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { resolveEftAdminDiscount } from '../../../api/domain/eft-admin-discount'

const d = (value: string) => new Decimal(value) as never

describe('resolveEftAdminDiscount', () => {
  const lines = [
    { id: 'line-a', totalPrice: d('1000.00'), customerPaidProductAmount: d('970.00') },
    { id: 'line-b', totalPrice: d('500.00'), customerPaidProductAmount: d('485.00') },
    { id: 'line-c', totalPrice: d('100.00'), customerPaidProductAmount: d('97.00') },
  ]

  it('spreads the discount by current paid amount and sums to the discount exactly', () => {
    const result = resolveEftAdminDiscount({
      lines,
      discount: d('100.00'),
      orderTotalAmount: d('1601.99'), // 1552 products + 49.99 shipping
      shippingAmount: d('49.99'),
    })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const shares = result.lines.map((line) => line.discountShare.toFixed(2))
    const total = result.lines.reduce((sum, line) => sum + Number(line.discountShare.toFixed(2)), 0)
    expect(total.toFixed(2)).toBe('100.00')
    expect(shares).toEqual(['62.50', '31.25', '6.25'])
    expect(result.lines.map((line) => line.newPaidAmount.toFixed(2))).toEqual([
      '907.50', '453.75', '90.75',
    ])
    expect(result.paidProductTotal.toFixed(2)).toBe('1552.00')
  })

  it('keeps a penny-exact total with a non-divisible discount', () => {
    const result = resolveEftAdminDiscount({
      lines,
      discount: d('0.10'),
      orderTotalAmount: d('1552.00'),
      shippingAmount: d('0'),
    })
    if (result.status !== 'ok') throw new Error('expected ok')
    const cents = result.lines.reduce((sum, line) => sum + Math.round(line.discountShare.toNumber() * 100), 0)
    expect(cents).toBe(10)
  })

  it('rejects a discount above the paid product total (shipping is never discounted)', () => {
    const result = resolveEftAdminDiscount({
      lines,
      discount: d('1552.01'),
      orderTotalAmount: d('1601.99'),
      shippingAmount: d('49.99'),
    })
    expect(result.status).toBe('exceeds_paid_product_total')
  })

  it('allows a discount equal to the paid product total', () => {
    const result = resolveEftAdminDiscount({
      lines,
      discount: d('1552.00'),
      orderTotalAmount: d('1601.99'),
      shippingAmount: d('49.99'),
    })
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.lines.every((line) => line.newPaidAmount.toFixed(2) === '0.00')).toBe(true)
  })

  it('falls back to totalPrice and caps by order total for legacy lines without a paid snapshot', () => {
    const legacy = [
      { id: 'line-a', totalPrice: d('1000.00'), customerPaidProductAmount: null },
    ]
    // Order carried a 50 TL coupon: order total (950) is below the line total.
    const result = resolveEftAdminDiscount({
      lines: legacy,
      discount: d('960.00'),
      orderTotalAmount: d('950.00'),
      shippingAmount: d('0'),
    })
    expect(result.status).toBe('exceeds_paid_product_total')
    if (result.status === 'exceeds_paid_product_total') {
      expect(result.paidProductTotal.toFixed(2)).toBe('950.00')
    }
  })
})
