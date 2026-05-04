import { describe, expect, it } from 'vitest'
import {
  getAvailableSellerWorkflowActions,
  getSellerWorkflowStep,
} from '../../../apps/seller-panel/src/lib/seller-order-workflow'

describe('seller workflow rules', () => {
  it('shows accept action for queue statuses', () => {
    expect(getAvailableSellerWorkflowActions('seller_queue_ready')).toEqual(['accept'])
    expect(getAvailableSellerWorkflowActions('seller_reviewing')).toEqual(['accept'])
  })

  it('shows shipment progression actions in order', () => {
    expect(getAvailableSellerWorkflowActions('seller_accepted')).toEqual(['preparing'])
    expect(getAvailableSellerWorkflowActions('preparing')).toEqual(['awaiting'])
    expect(getAvailableSellerWorkflowActions('awaiting_shipment')).toEqual(['tracking'])
  })

  it('returns terminal workflow step for shipped orders', () => {
    expect(getSellerWorkflowStep('shipped')).toBe(4)
    expect(getSellerWorkflowStep('delivery_confirmed')).toBe(4)
  })
})
