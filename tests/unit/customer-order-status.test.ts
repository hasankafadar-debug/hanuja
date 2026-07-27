import { describe, expect, it } from 'vitest'
import { getCustomerOrderStatusLabel } from '../../apps/web/src/lib/customer-order-status'

describe('customer order status labels', () => {
  it('uses designer terminology for seller-operated order states', () => {
    expect(getCustomerOrderStatusLabel('seller_queue_ready')).toBe('Tasarımcıya İletildi')
    expect(getCustomerOrderStatusLabel('seller_rejected')).toBe('Tasarımcı Reddetti')
    expect(getCustomerOrderStatusLabel('waiting_for_seller')).toBe('Tasarımcı Yanıtı Bekleniyor')
  })

  it('keeps the storefront completion label and falls back to shared labels for other states', () => {
    expect(getCustomerOrderStatusLabel('delivery_confirmed')).toBe('Tamamlanan Sipariş')
    expect(getCustomerOrderStatusLabel('shipped')).toBeUndefined()
  })
})
