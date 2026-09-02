import { describe, expect, it } from 'vitest'
import { Decimal } from '../__mocks__/prisma-runtime'
import {
  allocateQuantitySlice,
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
