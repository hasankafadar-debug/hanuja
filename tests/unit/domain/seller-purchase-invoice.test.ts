/**
 * Unit tests — seller-purchase-invoice.ts
 * The seller's invoice to Hanuja (satıcı Hanuja modeli): KDV-inclusive sale minus seller
 * coupon share minus KDV-inclusive commission, split by the product's own KDV rate.
 * CLAUDE.md §15.3 (12–14), 07-marketplace-finance-rules.md
 */
import { describe, expect, it } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import {
  calculateSellerPurchaseInvoice,
  formatPurchaseInvoiceAmount,
  formatPurchaseInvoiceRate,
  splitVatInclusiveAmount,
  type SellerPurchaseInvoiceLineInput,
} from '../../../api/domain/seller-purchase-invoice'
import { allocateProductRefund } from '../../../api/domain/quantity-allocation'
import { sumPayoutSnapshot } from '../../../api/domain/payout-calculator'

const money = (value: Decimal) => value.toFixed(2)

function line(overrides: Partial<SellerPurchaseInvoiceLineInput> = {}): SellerPurchaseInvoiceLineInput {
  return {
    id: 'line-1',
    productName: 'Gea Berjer',
    quantity: 1,
    cancelledQuantity: 0,
    totalPrice: new Decimal(1000),
    couponDiscountAmount: new Decimal(0),
    commissionRate: new Decimal(0.2),
    // 1.000 × %20 × (1 + %20 komisyon KDV'si) — snapshot written at order time.
    commissionAmount: new Decimal(240),
    commissionExemptedAt: null,
    taxRate: new Decimal(0.2),
    ...overrides,
  } as SellerPurchaseInvoiceLineInput
}

describe('calculateSellerPurchaseInvoice', () => {
  it('matches the agreed example: 1.000 TL sale, %20 commission + KDV → 760 TL KDV-inclusive invoice', () => {
    const invoice = calculateSellerPurchaseInvoice([line()])
    expect(money(invoice.grossAmount)).toBe('1000.00')
    expect(money(invoice.commissionAmount)).toBe('240.00')
    expect(money(invoice.invoiceAmount)).toBe('760.00')
    // The seller invoices at the product's own rate: 760 / 1,20 = 633,33 + 126,67 KDV.
    expect(money(invoice.netAmount)).toBe('633.33')
    expect(money(invoice.vatAmount)).toBe('126.67')
    expect(invoice.vatGroups).toHaveLength(1)
    expect(money(invoice.vatGroups[0]!.invoiceAmount)).toBe('760.00')
  })

  it("deducts the seller's coupon share (the commission snapshot is already on the reduced base)", () => {
    // Base 1.000 − 100 = 900; commission 900 × %20 × 1,20 = 216.
    const invoice = calculateSellerPurchaseInvoice([
      line({ couponDiscountAmount: new Decimal(100), commissionAmount: new Decimal(216) }),
    ])
    expect(money(invoice.couponShareAmount)).toBe('100.00')
    expect(money(invoice.commissionAmount)).toBe('216.00')
    expect(money(invoice.invoiceAmount)).toBe('684.00')
  })

  it('drops the commission of an exempted line, exactly like the payout snapshot', () => {
    const invoice = calculateSellerPurchaseInvoice([
      line({ commissionExemptedAt: new Date('2026-10-01T10:00:00Z') }),
    ])
    expect(money(invoice.commissionAmount)).toBe('0.00')
    expect(money(invoice.invoiceAmount)).toBe('1000.00')
  })

  it('invoices only the units that were not cancelled', () => {
    const invoice = calculateSellerPurchaseInvoice([
      line({ quantity: 3, cancelledQuantity: 1 }),
      line({ id: 'line-2', quantity: 2, cancelledQuantity: 2 }),
    ])
    expect(invoice.lines).toHaveLength(1)
    expect(invoice.lines[0]!.quantity).toBe(2)
    // 1.000 − roundMoney(1.000 / 3) = 666,67; commission 240 − 80 = 160.
    expect(money(invoice.grossAmount)).toBe('666.67')
    expect(money(invoice.commissionAmount)).toBe('160.00')
    expect(money(invoice.invoiceAmount)).toBe('506.67')
  })

  it('groups multiple KDV rates and keeps every split free of rounding gaps', () => {
    const invoice = calculateSellerPurchaseInvoice([
      line({ id: 'sofa', totalPrice: new Decimal(1000), commissionAmount: new Decimal(240), taxRate: new Decimal(0.2) }),
      line({ id: 'lamp', totalPrice: new Decimal(333.33), commissionAmount: new Decimal(80), taxRate: new Decimal(0.1) }),
      line({ id: 'vase', totalPrice: new Decimal(500), commissionAmount: new Decimal(120), taxRate: new Decimal(0.2) }),
    ])
    expect(invoice.vatGroups.map((group) => group.taxRate.toFixed(2))).toEqual(['0.20', '0.10'])
    expect(money(invoice.vatGroups[0]!.invoiceAmount)).toBe('1140.00')
    expect(money(invoice.vatGroups[1]!.invoiceAmount)).toBe('253.33')
    for (const group of invoice.vatGroups) {
      expect(money(group.netAmount.plus(group.vatAmount))).toBe(money(group.invoiceAmount))
    }
    expect(money(invoice.invoiceAmount)).toBe('1393.33')
    expect(money(invoice.netAmount.plus(invoice.vatAmount))).toBe('1393.33')
  })

  it('equals the payout net computed from accounted cancellations when nothing was returned', () => {
    // Three units, then two separate cancellations of one unit each (cumulative boundaries).
    const snapshot = {
      quantity: 3,
      totalPrice: new Decimal(1000),
      couponDiscountAmount: new Decimal(100),
      commissionAmount: new Decimal(216),
      netPayoutAmount: new Decimal(684),
      commissionExemptedAt: null,
    }
    const refunds = [allocateProductRefund(snapshot, 0, 1), allocateProductRefund(snapshot, 1, 1)]
    // Same arithmetic as payout.service.activateHold.
    const totals = sumPayoutSnapshot([snapshot])
    const refundedGross = refunds.reduce((sum, refund) => sum.plus(refund.grossAmount), new Decimal(0))
    const refundedCommission = refunds.reduce((sum, refund) => sum.plus(refund.commissionAmount), new Decimal(0))
    const refundedCoupon = refunds.reduce((sum, refund) => sum.plus(refund.couponAmount), new Decimal(0))
    const payoutNet = totals.grossAmount
      .minus(refundedGross)
      .minus(totals.commissionAmount.minus(refundedCommission))
      .minus(totals.couponShareAmount.minus(refundedCoupon))

    const invoice = calculateSellerPurchaseInvoice([line({ ...snapshot, cancelledQuantity: 2 })])
    expect(money(invoice.invoiceAmount)).toBe(money(payoutNet))
    // 333,33 brüt − 33,33 kupon − 72 komisyon.
    expect(money(invoice.invoiceAmount)).toBe('228.00')
  })

  it('returns an empty invoice for an order without billable units', () => {
    const invoice = calculateSellerPurchaseInvoice([line({ quantity: 1, cancelledQuantity: 1 })])
    expect(invoice.lines).toEqual([])
    expect(invoice.vatGroups).toEqual([])
    expect(money(invoice.invoiceAmount)).toBe('0.00')
  })
})

describe('purchase invoice formatting', () => {
  it('formats amounts the way the seller writes them on the invoice', () => {
    expect(formatPurchaseInvoiceAmount(new Decimal(760))).toBe('760,00 TL')
    expect(formatPurchaseInvoiceAmount(new Decimal(1234.5))).toBe('1.234,50 TL')
  })

  it('formats KDV rates as percentages', () => {
    expect(formatPurchaseInvoiceRate(new Decimal(0.2))).toBe('%20')
    expect(formatPurchaseInvoiceRate(new Decimal(0.125))).toBe('%12,5')
    expect(formatPurchaseInvoiceRate(new Decimal(0.01))).toBe('%1')
  })

  it('splits a KDV-inclusive amount into base and KDV with no kuruş lost', () => {
    const split = splitVatInclusiveAmount(new Decimal(100), new Decimal(0.1))
    // 100 / 1,10 = 90,909… → roundMoney 90,91; KDV the remainder.
    expect(money(split.netAmount)).toBe('90.91')
    expect(money(split.vatAmount)).toBe('9.09')
  })
})
