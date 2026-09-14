import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  allocateQuantitySlice,
  allocateProductRefund,
  isQuantityFullyClosed,
  quantityAvailable,
} from '../../api/domain/quantity-allocation'

describe('quantity money allocation', () => {
  it('allocates two of three units from the discounted product snapshot', () => {
    const amount = allocateQuantitySlice({
      totalAmount: new Decimal('89.99'),
      originalQuantity: 3,
      consumedQuantity: 0,
      requestedQuantity: 2,
    })

    expect(amount.toFixed(2)).toBe('59.99')
  })

  it('keeps repeated refunds equal to the exact snapshot despite penny rounding', () => {
    const totalAmount = new Decimal('100.00')
    const first = allocateQuantitySlice({
      totalAmount,
      originalQuantity: 3,
      consumedQuantity: 0,
      requestedQuantity: 1,
    })
    const second = allocateQuantitySlice({
      totalAmount,
      originalQuantity: 3,
      consumedQuantity: 1,
      requestedQuantity: 1,
    })
    const final = allocateQuantitySlice({
      totalAmount,
      originalQuantity: 3,
      consumedQuantity: 2,
      requestedQuantity: 1,
    })

    expect(first.toFixed(2)).toBe('33.33')
    expect(second.toFixed(2)).toBe('33.34')
    expect(final.toFixed(2)).toBe('33.33')
    expect(first.add(second).add(final).toFixed(2)).toBe('100.00')
  })

  it('rejects negative, zero, and over-limit slices', () => {
    const totalAmount = new Decimal('10.00')
    expect(() =>
      allocateQuantitySlice({
        totalAmount,
        originalQuantity: 3,
        consumedQuantity: 0,
        requestedQuantity: 0,
      }),
    ).toThrow()
    expect(() =>
      allocateQuantitySlice({
        totalAmount,
        originalQuantity: 3,
        consumedQuantity: 2,
        requestedQuantity: 2,
      }),
    ).toThrow()
  })
})

describe('quantity availability', () => {
  it('never returns a negative remaining quantity', () => {
    expect(
      quantityAvailable({
        originalQuantity: 3,
        cancelledQuantity: 2,
        shippedQuantity: 1,
      }),
    ).toBe(0)
    expect(
      quantityAvailable({
        originalQuantity: 3,
        cancelledQuantity: 4,
      }),
    ).toBe(0)
  })

  it('treats shipping as refundable only after cancellations and accepted returns close all units', () => {
    expect(
      isQuantityFullyClosed({
        originalQuantity: 3,
        cancelledQuantity: 2,
        acceptedReturnQuantity: 0,
      }),
    ).toBe(false)
    expect(
      isQuantityFullyClosed({
        originalQuantity: 3,
        cancelledQuantity: 2,
        acceptedReturnQuantity: 1,
      }),
    ).toBe(true)
  })
})

describe('product refund financial components', () => {
  it.each([
    ['standard', '1000', '0', '180', '1000', false, '820'],
    ['exempt', '1000', '0', '180', '1000', true, '1000'],
    ['seller coupon', '1000', '100', '162', '900', false, '738'],
    ['platform coupon', '1000', '0', '180', '900', false, '820'],
    ['EFT discount', '1000', '0', '180', '950', false, '820'],
    ['coupon and EFT exempt', '1000', '100', '162', '855', true, '900'],
    ['rounding', '100', '0.01', '18.01', '94.99', false, '81.98'],
  ])(
    '%s: partial operations preserve customer and seller totals',
    (_, gross, coupon, commission, paid, exempt, expectedNet) => {
      const line = {
        quantity: 3,
        totalPrice: new Decimal(gross),
        couponDiscountAmount: new Decimal(coupon),
        commissionAmount: new Decimal(commission),
        customerPaidProductAmount: new Decimal(paid),
        commissionExemptedAt: exempt ? new Date() : null,
      }
      const parts = [0, 1, 2].map((offset) =>
        allocateProductRefund(line, offset, 1),
      )
      for (const part of parts) {
        expect(
          part.sellerAmount
            .add(part.commissionAmount)
            .add(part.couponAmount)
            .toFixed(2),
        ).toBe(part.grossAmount.toFixed(2))
      }
      expect(
        parts
          .reduce((sum, part) => sum.add(part.sellerAmount), new Decimal(0))
          .toFixed(2),
      ).toBe(new Decimal(expectedNet).toFixed(2))
      expect(
        parts
          .reduce((sum, part) => sum.add(part.customerAmount), new Decimal(0))
          .toFixed(2),
      ).toBe(new Decimal(paid).toFixed(2))
      const full = allocateProductRefund(line, 0, 3)
      expect(full.sellerAmount.toFixed(2)).toBe(
        new Decimal(expectedNet).toFixed(2),
      )
      expect(line.commissionAmount.toFixed(2)).toBe(
        new Decimal(commission).toFixed(2),
      )
    },
  )

  it('accepted and disputed quantities retain every penny of the requested refund', () => {
    const request = {
      quantity: 3,
      totalPrice: new Decimal('100'),
      customerPaidProductAmount: new Decimal('94.99'),
      couponDiscountAmount: new Decimal('0.01'),
      commissionAmount: new Decimal('18.01'),
    }
    const accepted = allocateProductRefund(request, 0, 1)
    const disputed = allocateProductRefund(request, 1, 2)
    expect(accepted.sellerAmount.add(disputed.sellerAmount).toFixed(2)).toBe(
      '81.98',
    )
    expect(
      accepted.customerAmount.add(disputed.customerAmount).toFixed(2),
    ).toBe('94.99')
    expect(
      accepted.commissionAmount.add(disputed.commissionAmount).toFixed(2),
    ).toBe('18.01')
  })
})
