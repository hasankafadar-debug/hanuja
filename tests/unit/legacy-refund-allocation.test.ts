import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  allocateLegacyFullRefund,
  LEGACY_FINANCIAL_REVIEW_PREFIX,
} from '../../api/domain/legacy-refund-allocation'

const line = (overrides: Record<string, unknown> = {}) => ({
  sellerId: 'seller-1',
  quantity: 2,
  totalPrice: new Decimal('1000.00'),
  couponDiscountAmount: new Decimal('100.00'),
  commissionAmount: new Decimal('162.00'),
  netPayoutAmount: new Decimal('738.00'),
  commissionExemptedAt: null,
  ...overrides,
})

const allocate = (overrides: Record<string, unknown> = {}) =>
  allocateLegacyFullRefund({
    sellerId: 'seller-1',
    requestedCustomerAmount: new Decimal('1000.00'),
    orderGrossAmount: new Decimal('1000.00'),
    orderTotalAmount: new Decimal('950.00'),
    lines: [line()],
    confirmedPayments: [{ amount: new Decimal('950.00'), refundedAmount: new Decimal(0) }],
    otherRefundAmount: new Decimal(0),
    ...overrides,
  })

describe('legacy full refund allocation', () => {
  it('requires reconciliation instead of guessing money remaining after historical refunds', () => {
    const result = allocate({ hasHistoricalRefundEvidence: true })
    expect(result.manualReviewReason).toContain('tarihî iade kanıtı')
    expect(result.customerAmount.toFixed(2)).toBe('0.00')
    expect(result.grossProductAmount.toFixed(2)).toBe('0.00')
    expect(result.sellerAdjustmentAmount.toFixed(2)).toBe('0.00')
  })

  it('separates the collected customer amount from stored seller finance snapshots', () => {
    const result = allocate()

    expect(result.manualReviewReason).toBeNull()
    expect(result.customerAmount.toFixed(2)).toBe('950.00')
    expect(result.grossProductAmount.toFixed(2)).toBe('1000.00')
    expect(result.couponAdjustmentAmount.toFixed(2)).toBe('100.00')
    expect(result.commissionAdjustmentAmount.toFixed(2)).toBe('162.00')
    expect(result.sellerAdjustmentAmount.toFixed(2)).toBe('738.00')
    expect(result.platformFundedAmount.toFixed(2)).toBe('50.00')
  })

  it('uses the historical commission snapshot without applying a current rate', () => {
    const result = allocate({
      lines: [line({
        commissionAmount: new Decimal('117.00'),
        netPayoutAmount: new Decimal('783.00'),
      })],
    })

    expect(result.manualReviewReason).toBeNull()
    expect(result.commissionAdjustmentAmount.toFixed(2)).toBe('117.00')
    expect(result.sellerAdjustmentAmount.toFixed(2)).toBe('783.00')
  })

  it('reverses no commission for an exempt historical line', () => {
    const result = allocate({
      lines: [line({ commissionExemptedAt: new Date('2026-08-01T00:00:00Z') })],
    })

    expect(result.manualReviewReason).toBeNull()
    expect(result.commissionAdjustmentAmount.toFixed(2)).toBe('0.00')
    expect(result.sellerAdjustmentAmount.toFixed(2)).toBe('900.00')
  })

  it('routes a partial amount without item allocation to review', () => {
    const result = allocate({ requestedCustomerAmount: new Decimal('400.00') })

    expect(result.manualReviewReason).toContain('kısmi tutar')
    expect(result.manualReviewReason).toMatch(new RegExp(`^${LEGACY_FINANCIAL_REVIEW_PREFIX}`))
    expect(result.customerAmount.toFixed(2)).toBe('400.00')
    expect(result.grossProductAmount.toFixed(2)).toBe('0.00')
    expect(result.sellerAdjustmentAmount.toFixed(2)).toBe('0.00')
  })

  it('routes missing or conflicting payment snapshots to review without a payable amount', () => {
    const missing = allocate({ confirmedPayments: [] })
    const mismatch = allocate({
      confirmedPayments: [{ amount: new Decimal('951.00'), refundedAmount: new Decimal(0) }],
    })

    expect(missing.manualReviewReason).toContain('doğrulanmış ödeme')
    expect(missing.customerAmount.toFixed(2)).toBe('0.00')
    expect(mismatch.manualReviewReason).toContain('sipariş toplamıyla')
    expect(mismatch.customerAmount.toFixed(2)).toBe('0.00')
  })

  it('does not guess which products remain after an earlier refund', () => {
    const result = allocate({
      confirmedPayments: [{ amount: new Decimal('950.00'), refundedAmount: new Decimal('200.00') }],
      otherRefundAmount: new Decimal('200.00'),
    })

    expect(result.manualReviewReason).toContain('önceki iadenin hangi ürünlere')
    expect(result.customerAmount.toFixed(2)).toBe('750.00')
    expect(result.grossProductAmount.toFixed(2)).toBe('0.00')
  })

  it('routes inconsistent line finance snapshots to review and creates no seller amounts', () => {
    const result = allocate({
      lines: [line({ netPayoutAmount: new Decimal('800.00') })],
    })

    expect(result.manualReviewReason).toContain('net hakediş snapshot')
    expect(result.grossProductAmount.toFixed(2)).toBe('0.00')
    expect(result.commissionAdjustmentAmount.toFixed(2)).toBe('0.00')
  })
})
