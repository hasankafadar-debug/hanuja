import { describe, expect, it } from 'vitest'
import {
  getSellerOrderStatusesForTab,
  getSellerOrderTabLabel,
  isSellerOrderTab,
} from '../../../api/domain/seller-order-tabs'

describe('seller order tabs', () => {
  it('maps acik tab to queue statuses', () => {
    expect(getSellerOrderStatusesForTab('acik')).toEqual(['seller_queue_ready', 'seller_reviewing'])
  })

  it('maps iade tab to return and refund statuses', () => {
    expect(getSellerOrderStatusesForTab('iade-edilenler')).toContain('refund_completed')
    expect(getSellerOrderStatusesForTab('iade-edilenler')).toContain('return_requested')
  })

  it('maps missing invoice tab to active fulfillment statuses', () => {
    expect(getSellerOrderStatusesForTab('faturasi-olmayanlar')).toContain('seller_queue_ready')
    expect(getSellerOrderStatusesForTab('faturasi-olmayanlar')).toContain('delivery_confirmed')
    expect(getSellerOrderStatusesForTab('faturasi-olmayanlar')).not.toContain('cancelled_by_customer')
  })

  it('recognizes valid tabs and rejects invalid values', () => {
    expect(isSellerOrderTab('tum')).toBe(true)
    expect(isSellerOrderTab('faturasi-olmayanlar')).toBe(true)
    expect(isSellerOrderTab('unknown')).toBe(false)
  })

  it('returns labels for known tabs', () => {
    expect(getSellerOrderTabLabel('teslim-edilenler')).toBe('Teslim Edilenler')
  })
})
