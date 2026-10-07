import { describe, expect, it } from 'vitest'
import { isDeliveryReviewLine } from '../../../api/domain/delivery-review'

const shipped = {
  quantity: 3,
  cancelledQuantity: 1,
  shippedQuantity: 2,
  fulfilledAt: new Date(),
  deliveryConfirmedAt: null,
}
describe('delivery review line eligibility', () => {
  it('requires all active units to be shipped in v2', () => {
    expect(isDeliveryReviewLine(shipped, 2)).toBe(true)
    expect(isDeliveryReviewLine({ ...shipped, shippedQuantity: 1 }, 2)).toBe(false)
    expect(isDeliveryReviewLine({ ...shipped, shippedQuantity: 0 }, 2)).toBe(false)
  })
  it('excludes cancelled or confirmed lines', () => {
    expect(isDeliveryReviewLine({ ...shipped, cancelledQuantity: 3 }, 2)).toBe(false)
    expect(isDeliveryReviewLine({ ...shipped, deliveryConfirmedAt: new Date() }, 2)).toBe(false)
  })
  it('uses the seller line shipping timestamp for legacy orders', () => {
    expect(isDeliveryReviewLine({ ...shipped, shippedQuantity: 0 }, 1)).toBe(true)
    expect(isDeliveryReviewLine({ ...shipped, fulfilledAt: null }, 1)).toBe(false)
  })
})
