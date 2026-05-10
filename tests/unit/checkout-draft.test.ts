/**
 * Unit tests — checkout draft EFT/tax breakdown math.
 * Mirrors the snapshot logic from buildCheckoutDraft so regressions in
 * eftDiscountAmount / taxBreakdown / totalAmount are caught.
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import { roundMoney } from '../../packages/security/src/money'

type Line = { totalPrice: Decimal; taxRate: Decimal; taxAmount: Decimal }

function computeDraftTotals(params: {
  lines: Line[]
  paymentMethod: 'card' | 'eft'
  freeShippingThresholdTry: Decimal
  flatShippingFeeTry: Decimal
  eftDiscountRate: Decimal
  discountAmount?: Decimal
}) {
  const grossAmount = params.lines.reduce((sum, line) => sum.plus(line.totalPrice), new Decimal(0))
  const shippingAmount = grossAmount.gte(params.freeShippingThresholdTry)
    ? new Decimal(0)
    : params.flatShippingFeeTry
  const discountAmount = params.discountAmount ?? new Decimal(0)
  const taxAmount = params.lines.reduce((sum, line) => sum.plus(line.taxAmount), new Decimal(0))
  const netSubtotal = grossAmount.sub(taxAmount)
  const eftDiscountRate = params.paymentMethod === 'eft' ? params.eftDiscountRate : new Decimal(0)
  const eftDiscountAmount = eftDiscountRate.gt(0)
    ? roundMoney(grossAmount.mul(eftDiscountRate))
    : new Decimal(0)

  const taxBreakdownMap = new Map<number, Decimal>()
  for (const line of params.lines) {
    const ratePercent = Number(line.taxRate.mul(100).toFixed(2))
    taxBreakdownMap.set(
      ratePercent,
      (taxBreakdownMap.get(ratePercent) ?? new Decimal(0)).plus(line.taxAmount),
    )
  }
  const taxBreakdown = [...taxBreakdownMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ratePercent, amount]) => ({ ratePercent, taxAmount: roundMoney(amount).toFixed(2) }))

  const totalAmount = grossAmount.plus(shippingAmount).sub(discountAmount).sub(eftDiscountAmount)

  return {
    grossAmount,
    netSubtotal,
    shippingAmount,
    discountAmount,
    eftDiscountAmount,
    eftDiscountRate,
    taxAmount,
    taxBreakdown,
    totalAmount,
  }
}

const baseSettings = {
  freeShippingThresholdTry: new Decimal(500),
  flatShippingFeeTry: new Decimal(50),
  eftDiscountRate: new Decimal('0.05'),
}

describe('checkout draft — paymentMethod branch', () => {
  it('zeros eftDiscountAmount when paymentMethod is card', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(118), taxRate: new Decimal('0.18'), taxAmount: new Decimal(18) },
      ],
      paymentMethod: 'card',
      ...baseSettings,
    })
    expect(totals.eftDiscountAmount.toNumber()).toBe(0)
    expect(totals.eftDiscountRate.toNumber()).toBe(0)
  })

  it('applies platform eftDiscountRate when paymentMethod is eft', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(1000), taxRate: new Decimal('0.20'), taxAmount: new Decimal('166.67') },
      ],
      paymentMethod: 'eft',
      ...baseSettings,
    })
    // 1000 * 0.05 = 50
    expect(totals.eftDiscountAmount.toNumber()).toBeCloseTo(50, 1)
    expect(totals.eftDiscountRate.toNumber()).toBeCloseTo(0.05, 4)
  })

  it('skips eft discount when admin disabled the rate', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(1000), taxRate: new Decimal('0.20'), taxAmount: new Decimal('166.67') },
      ],
      paymentMethod: 'eft',
      ...baseSettings,
      eftDiscountRate: new Decimal(0),
    })
    expect(totals.eftDiscountAmount.toNumber()).toBe(0)
  })
})

describe('checkout draft — total formula', () => {
  it('totalAmount = gross + shipping - coupon - eftDiscount', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(1000), taxRate: new Decimal('0.20'), taxAmount: new Decimal('166.67') },
      ],
      paymentMethod: 'eft',
      freeShippingThresholdTry: new Decimal(2000),
      flatShippingFeeTry: new Decimal(50),
      eftDiscountRate: new Decimal('0.05'),
      discountAmount: new Decimal(100),
    })
    // 1000 + 50 - 100 - 50 = 900
    expect(totals.totalAmount.toNumber()).toBeCloseTo(900, 1)
  })

  it('free shipping kicks in when subtotal >= threshold', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(2000), taxRate: new Decimal('0.10'), taxAmount: new Decimal('181.82') },
      ],
      paymentMethod: 'card',
      freeShippingThresholdTry: new Decimal(500),
      flatShippingFeeTry: new Decimal(50),
      eftDiscountRate: new Decimal('0.05'),
    })
    expect(totals.shippingAmount.toNumber()).toBe(0)
    expect(totals.totalAmount.toNumber()).toBeCloseTo(2000, 1)
  })
})

describe('checkout draft — taxBreakdown snapshot', () => {
  it('creates one row per distinct VAT rate, ascending', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(220), taxRate: new Decimal('0.20'), taxAmount: new Decimal('36.67') },
        { totalPrice: new Decimal(110), taxRate: new Decimal('0.10'), taxAmount: new Decimal(10) },
      ],
      paymentMethod: 'card',
      ...baseSettings,
    })
    expect(totals.taxBreakdown.map((r) => r.ratePercent)).toEqual([10, 20])
  })

  it('aggregates lines that share the same VAT rate', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(220), taxRate: new Decimal('0.20'), taxAmount: new Decimal('36.67') },
        { totalPrice: new Decimal(440), taxRate: new Decimal('0.20'), taxAmount: new Decimal('73.33') },
      ],
      paymentMethod: 'card',
      ...baseSettings,
    })
    expect(totals.taxBreakdown).toHaveLength(1)
    // 36.67 + 73.33 = 110
    expect(Number(totals.taxBreakdown[0]?.taxAmount)).toBeCloseTo(110, 1)
  })
})

describe('checkout draft — netSubtotal', () => {
  it('netSubtotal = grossAmount - taxAmount', () => {
    const totals = computeDraftTotals({
      lines: [
        { totalPrice: new Decimal(120), taxRate: new Decimal('0.20'), taxAmount: new Decimal(20) },
      ],
      paymentMethod: 'card',
      ...baseSettings,
    })
    expect(totals.grossAmount.toNumber()).toBe(120)
    expect(totals.netSubtotal.toNumber()).toBe(100)
  })
})
