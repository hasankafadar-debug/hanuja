import { describe, expect, it } from 'vitest'
import {
  buildThreadKey,
  checkOrderAskable,
  checkPresaleAskable,
  checkQuestionBodyLength,
  isThreadUnread,
  statusAfterMessage,
  statusTurnedOverBy,
} from '../../../api/domain/product-question'

describe('product question domain rules', () => {
  it('trims and bounds message bodies', () => {
    expect(checkQuestionBodyLength('  a ')).toEqual({ ok: false, reason: 'too_short' })
    expect(checkQuestionBodyLength('  ab  ')).toEqual({ ok: true, body: 'ab' })
    expect(checkQuestionBodyLength('x'.repeat(2000))).toMatchObject({ ok: true })
    expect(checkQuestionBodyLength('x'.repeat(2001))).toEqual({ ok: false, reason: 'too_long' })
    // Surrounding whitespace does not count against the limit.
    expect(checkQuestionBodyLength(`   ${'x'.repeat(2000)}   `)).toMatchObject({ ok: true })
  })

  it('builds a unique key that also distinguishes pre-sale from order conversations', () => {
    expect(buildThreadKey('c1', 'p1', null)).toBe('c1:p1:presale')
    expect(buildThreadKey('c1', 'p1', 'o1')).toBe('c1:p1:o1')
  })

  it('turns the conversation over to the other side', () => {
    expect(statusAfterMessage('customer')).toBe('waiting_for_seller')
    expect(statusAfterMessage('seller')).toBe('waiting_for_customer')
    expect(statusTurnedOverBy('customer')).toBe('waiting_for_customer')
    expect(statusTurnedOverBy('seller')).toBe('waiting_for_seller')
  })

  it('allows pre-sale questions only on a product on sale right now', () => {
    const base = {
      productStatus: 'published' as const,
      sellerStatus: 'active' as const,
      vacationModeEnabled: false,
      sellerUserId: 's-user',
      customerId: 'c1',
    }
    expect(checkPresaleAskable(base)).toEqual({ ok: true })
    expect(checkPresaleAskable({ ...base, productStatus: 'unlisted' })).toMatchObject({ reason: 'product_not_published' })
    expect(checkPresaleAskable({ ...base, sellerStatus: 'suspended' })).toMatchObject({ reason: 'seller_not_active' })
    expect(checkPresaleAskable({ ...base, vacationModeEnabled: true })).toMatchObject({ reason: 'seller_on_vacation' })
    expect(checkPresaleAskable({ ...base, customerId: 's-user' })).toMatchObject({ reason: 'own_product' })
  })

  it('allows order questions regardless of the product sale state but only for seller-visible orders', () => {
    const base = { orderFound: true, paymentConfirmed: true, lineFound: true, sellerStatus: 'active' as const }
    expect(checkOrderAskable(base)).toEqual({ ok: true })
    expect(checkOrderAskable({ ...base, sellerStatus: 'suspended' })).toEqual({ ok: true })
    expect(checkOrderAskable({ ...base, orderFound: false })).toMatchObject({ reason: 'order_not_found' })
    expect(checkOrderAskable({ ...base, paymentConfirmed: false })).toMatchObject({ reason: 'payment_not_confirmed' })
    expect(checkOrderAskable({ ...base, lineFound: false })).toMatchObject({ reason: 'product_not_in_order' })
    expect(checkOrderAskable({ ...base, sellerStatus: 'rejected' })).toMatchObject({ reason: 'seller_not_operational' })
  })

  it('treats a thread as unread only when the other side wrote past the read boundary', () => {
    expect(isThreadUnread(0, 0)).toBe(false)
    expect(isThreadUnread(3, 0)).toBe(true)
    expect(isThreadUnread(3, 3)).toBe(false)
    expect(isThreadUnread(4, 3)).toBe(true)
    expect(isThreadUnread(2, 5)).toBe(false)
  })
})
