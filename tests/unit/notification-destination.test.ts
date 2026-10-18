import { describe, expect, it } from 'vitest'
import { notificationHref } from '../../api/lib/notification-destination'
import { getPlatformBaseUrls } from '../../api/lib/platform-info'

describe('panel notification destinations', () => {
  it.each([
    ['admin', 'order_canceled', { orderId: 'o1' }, '/siparisler/o1'],
    ['admin', 'admin_support_new_ticket', { threadId: 't1' }, '/musteri-sorulari/t1'],
    ['admin', 'admin_support_new_ticket', { ticketId: 's1' }, '/destek/s1'],
    [
      'admin',
      'admin_support_new_ticket',
      { threadId: 't1', ticketId: 's1' },
      '/musteri-sorulari/t1',
    ],
    ['admin', 'admin_customer_support_new', { ticketId: 'c1' }, '/musteri-destek/c1'],
    ['admin', 'admin_customer_support_reply', { ticketId: 'c1' }, '/musteri-destek/c1'],
    ['admin', 'admin_fulfillment_risk', { orderId: 'o1' }, '/siparisler/o1'],
    ['admin', 'admin_order_cancellation', { orderId: 'o1' }, '/siparisler/o1'],
    ['admin', 'admin_dispute_opened', { disputeId: 'd1' }, '/uyusmazliklar/d1'],
    ['admin', 'admin_return_requested', { returnRequestId: 'r1' }, '/iadeler/r1'],
    ['admin', 'admin_seller_application', { sellerId: 's1' }, '/saticilar/s1'],
    ['seller', 'seller_product_question', { threadId: 't1' }, '/musteri-sorulari/t1'],
    ['seller', 'seller_support_reply', { ticketId: 's1' }, '/destek/s1'],
    ['seller', 'seller_announcement', { announcementId: 'a1' }, '/duyurular/a1'],
    ['seller', 'seller_order_received', { orderId: 'o1' }, '/siparisler/o1'],
    ['seller', 'seller_invoice_reminder', { orderId: 'o1' }, '/siparisler/o1'],
    ['seller', 'seller_invoice_rejected', { orderId: 'o1' }, '/siparisler/o1'],
    ['seller', 'seller_refund_completed', { orderId: 'o1' }, '/siparisler/o1'],
    ['seller', 'fulfillment_warning_5days', { orderId: 'o1' }, '/siparisler/o1'],
    ['seller', 'seller_return_request', { returnRequestId: 'r1' }, '/iadeler/r1'],
    ['seller', 'seller_return_shipped', { operationId: 'r1' }, '/iadeler/r1'],
    ['seller', 'seller_return_decision', { returnId: 'r1' }, '/iadeler/r1'],
    ['seller', 'seller_return_invoice_uploaded', { returnRequestId: 'r1' }, '/iadeler/r1'],
    ['seller', 'payout_paid', {}, '/odemeler'],
    ['seller', 'seller_bank_detail_pending', {}, '/ayarlar?tab=bank'],
    ['seller', 'seller_documents_requested', {}, '/ayarlar?tab=documents'],
  ] as const)('%s %s opens its own record', (panel, type, data, expected) => {
    expect(notificationHref(panel, { type, data })).toBe(expected)
  })

  it('resolves absolute and relative URLs in old notification records', () => {
    expect(
      notificationHref('seller', {
        type: 'seller_product_question',
        data: {
          panelUrl: getPlatformBaseUrls().seller + '/musteri-sorulari/old',
        },
      }),
    ).toBe('/musteri-sorulari/old')
    expect(
      notificationHref('admin', {
        type: 'admin_support_new_ticket',
        data: { adminUrl: '/musteri-sorulari/old' },
      }),
    ).toBe('/musteri-sorulari/old')
  })

  it('uses the matching list when old records lack an identity', () => {
    expect(
      notificationHref('seller', {
        type: 'seller_product_question',
        data: null,
      }),
    ).toBe('/musteri-sorulari')
    expect(notificationHref('admin', { type: 'admin_bank_transfer_pending' })).toBe(
      '/odemeler?method=eft&status=pending',
    )
  })

  it.each([
    'https://evil.test/musteri-sorulari/t1',
    '//evil.test/musteri-sorulari/t1',
    'javascript:alert(1)',
    '/siparisler/t1',
    '/musteri-sorulari/../ayarlar',
    '/musteri-sorulari/t1?redirect=https://evil.test',
    '/musteri-sorulari/t1#fragment',
    '/musteri-sorulari/%2f%2fevil.test',
  ])('rejects unsafe or unrelated destination %s', (panelUrl) => {
    expect(
      notificationHref('seller', {
        type: 'seller_product_question',
        data: { panelUrl },
      }),
    ).toBe('/musteri-sorulari')
  })

  it('does not cross panel boundaries or guess targets for unknown types', () => {
    expect(
      notificationHref('seller', {
        type: 'admin_support_new_ticket',
        data: { threadId: 't1' },
      }),
    ).toBeNull()
    expect(
      notificationHref('admin', {
        type: 'unknown',
        data: { adminUrl: '/dashboard' },
      }),
    ).toBeNull()
  })
})
