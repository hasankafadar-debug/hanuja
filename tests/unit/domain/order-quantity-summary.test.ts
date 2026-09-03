import { describe, expect, it } from 'vitest'
import { summarizeOrderQuantities } from '../../../api/domain/order-quantity-summary'

describe('order quantity summary', () => {
  it('uses v2 active quantities and keeps the original/cancelled/shipped totals separate', () => {
    expect(
      summarizeOrderQuantities([
        { quantity: 5, activeQuantity: 3, cancelledQuantity: 2, shippedQuantity: 1 },
        { quantity: 2, activeQuantity: null, cancelledQuantity: 1, shippedQuantity: 2 },
      ]),
    ).toEqual({
      originalQuantity: 7,
      currentQuantity: 4,
      cancelledQuantity: 3,
      shippedQuantity: 3,
    })
  })

  it('clamps a negative active quantity and handles an empty order', () => {
    expect(
      summarizeOrderQuantities([
        { quantity: 1, activeQuantity: -2, cancelledQuantity: 0, shippedQuantity: 0 },
      ]),
    ).toMatchObject({ currentQuantity: 0 })
    expect(summarizeOrderQuantities([])).toEqual({
      originalQuantity: 0,
      currentQuantity: 0,
      cancelledQuantity: 0,
      shippedQuantity: 0,
    })
  })
})
