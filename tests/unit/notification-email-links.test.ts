import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canonicalNotificationEmailData,
  validateNotificationEmailLinks,
} from '../../api/lib/notification-email-links'
import {
  getCustomerOrderUrl,
  getPlatformBaseUrls,
  getPlatformLink,
} from '../../api/lib/platform-info'

describe('notification action destinations', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://www.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_SELLER_PANEL_URL', 'https://satici.hanuja.com.tr')
    vi.stubEnv('NEXT_PUBLIC_ADMIN_PANEL_URL', 'https://admin.hanuja.com.tr')
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each([
    'https://www.hanuja.com.tr',
    'https://satici.hanuja.com.tr',
    'https://admin.hanuja.com.tr',
  ])('ignores producer app %s', (origin) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin)
    expect(getCustomerOrderUrl('o1')).toBe('https://www.hanuja.com.tr/siparis/o1')
  })
  it('rejects a storefront configured as a panel and invalid production schemes', () => {
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'https://satici.hanuja.com.tr')
    expect(() => getPlatformBaseUrls()).toThrow('EMAIL_BASE_URL_ROLE_MISMATCH')
    vi.stubEnv('NEXT_PUBLIC_WEB_URL', 'http://localhost:3000')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => getPlatformBaseUrls()).toThrow('EMAIL_BASE_URL_INVALID:customer')
  })
  it.each([
    'https://admin.hanuja.com.tr/siparis/o1?next=bad',
    'https://satici.hanuja.com.tr/siparis/o1',
  ])('recovers only legacy order identity from %s', (orderUrl) => {
    expect(canonicalNotificationEmailData('order_payment_confirmed', { orderUrl })).toMatchObject({
      orderId: 'o1',
      orderUrl: 'https://www.hanuja.com.tr/siparis/o1',
    })
  })
  it.each([
    'https://attacker.test/siparis/o1',
    'https://admin.hanuja.com.tr/siparisler/o1',
    'https://user@admin.hanuja.com.tr/siparis/o1',
  ])('refuses identity from %s', (orderUrl) => {
    expect(() => canonicalNotificationEmailData('order_payment_confirmed', { orderUrl })).toThrow(
      'EMAIL_DATA_MISSING:orderId',
    )
  })
  it('rebuilds contract links using the same customer origin', () => {
    const data = canonicalNotificationEmailData('order_placed', {
      orderId: 'o1',
      contracts: { distanceSalesUrl: 'https://admin.hanuja.com.tr/bad' },
    })!
    expect(data.contracts).toEqual({
      preInformationUrl:
        'https://www.hanuja.com.tr/api/orders/o1/documents/contracts/pre-information?goruntule=1',
      distanceSalesUrl:
        'https://www.hanuja.com.tr/api/orders/o1/documents/contracts/distance-sales?goruntule=1',
    })
  })
  it('rejects a cross-audience direct caller and leaves carrier tracking links intact', () => {
    expect(() =>
      validateNotificationEmailLinks('order_shipped', {
        orderUrl: 'https://admin.hanuja.com.tr/siparis/o1',
      }),
    ).toThrow('EMAIL_LINK_INVALID:orderUrl')
    const data = canonicalNotificationEmailData('order_shipped', {
      orderId: 'o1',
      trackingUrl: 'https://carrier.test/track?q=1',
    })!
    expect(data.trackingUrl).toBe('https://carrier.test/track?q=1')
  })
  it.each([
    [
      'seller_order_received',
      { orderId: 'o1' },
      'panelUrl',
      'https://satici.hanuja.com.tr/siparisler/o1',
    ],
    [
      'seller_return_request',
      { returnRequestId: 'r1' },
      'panelUrl',
      'https://satici.hanuja.com.tr/iadeler/r1',
    ],
    [
      'seller_product_question',
      { threadId: 't1' },
      'panelUrl',
      'https://satici.hanuja.com.tr/musteri-sorulari/t1',
    ],
    [
      'customer_product_question_answered',
      { threadId: 't1' },
      'threadUrl',
      'https://www.hanuja.com.tr/hesabim/sorularim/t1',
    ],
    [
      'seller_announcement',
      { announcementId: 'a1' },
      'panelUrl',
      'https://satici.hanuja.com.tr/duyurular/a1',
    ],
  ] as const)('uses the audience and actual route for %s', (type, input, key, expected) => {
    const data = canonicalNotificationEmailData(type, input)!
    expect(data[key]).toBe(expected)
    expect(() => validateNotificationEmailLinks(type, data)).not.toThrow()
  })
  it('rejects the wrong panel or route for admin operations', () => {
    for (const adminUrl of [
      'https://satici.hanuja.com.tr/odemeler',
      'https://admin.hanuja.com.tr/siparis/o1',
    ])
      expect(() =>
        canonicalNotificationEmailData('admin_bank_transfer_pending', { adminUrl }),
      ).toThrow('EMAIL_LINK_INVALID:adminUrl')
  })
  it('repairs product actions while preserving only the product variant query', () => {
    const data = canonicalNotificationEmailData('product_price_drop', {
      productUrl: 'https://admin.hanuja.com.tr/urun/test?varyant=v1&next=bad',
    })!
    expect(data.productUrl).toBe('https://www.hanuja.com.tr/urun/test?varyant=v1')
    expect(() => validateNotificationEmailLinks('product_price_drop', data)).not.toThrow()
  })
  it('encodes identifiers and rejects protocol-relative paths', () => {
    expect(getCustomerOrderUrl('o/1')).toContain('/siparis/o%2F1')
    expect(() => getPlatformLink('customer', '//attacker.test')).toThrow('EMAIL_LINK_PATH_INVALID')
  })
})

describe('admin order-number formatting', () => {
  it('emits one prefix for already-prefixed historical numbers', async () => {
    const { adminBankTransferPendingTemplate } =
      await import('../../api/lib/email-templates/admin-operations')
    const mail = adminBankTransferPendingTemplate({
      orderNumber: '#26050080',
      adminUrl: 'https://admin.hanuja.com.tr/odemeler',
    })
    expect(mail.subject).toContain('#26050080')
    expect(mail.html + mail.text + mail.subject).not.toContain('##26050080')
  })
})
