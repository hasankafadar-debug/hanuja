import type { NotificationType } from '@prisma/client'
import {
  DEFAULT_ADMIN_PANEL_URL,
  DEFAULT_SELLER_PANEL_URL,
  DEFAULT_WEB_URL,
  getCustomerContractLinks,
  getCustomerInvoiceUrl,
  getCustomerOrderUrl,
  getPlatformBaseUrls,
  getPlatformLink,
  getSellerOrderUrl,
  type PlatformAudience,
} from './platform-info'

type EmailData = Record<string, unknown>

const CUSTOMER_ORDER_TYPES = new Set<string>([
  'order_placed',
  'order_payment_confirmed',
  'order_shipped',
  'order_delivery_confirmed',
  'order_cancelled',
  'return_requested',
  'return_status_changed',
  'order_return_approved',
  'order_return_rejected',
  'refund_completed',
  'invoice_uploaded',
])

const ADMIN_PATHS: Record<string, RegExp> = {
  admin_order_cancellation: /^\/siparisler\/[^/]+$/,
  admin_fulfillment_risk: /^\/siparisler\/[^/]+$/,
  admin_return_requested: /^\/iadeler$/,
  admin_dispute_opened: /^\/uyusmazliklar\/[^/]+$/,
  admin_support_new_ticket: /^\/destek\/[^/]+$/,
  admin_customer_support_new: /^\/musteri-destek\/[^/]+$/,
  admin_bank_transfer_pending: /^\/odemeler$/,
  admin_seller_application: /^\/saticilar\/[^/]+$/,
}

function string(data: EmailData, key: string): string | undefined {
  return typeof data[key] === 'string' && data[key].trim() ? data[key].trim() : undefined
}

/** Only known platform origins can supply identity for a pre-fix queue payload. */
function knownPlatformUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    const origins = [
      ...Object.values(getPlatformBaseUrls()),
      DEFAULT_WEB_URL,
      DEFAULT_SELLER_PANEL_URL,
      DEFAULT_ADMIN_PANEL_URL,
    ]
    return origins.includes(url.origin) && !url.username && !url.password && !url.hash ? url : null
  } catch {
    return null
  }
}

function identity(
  data: EmailData,
  key: string,
  aliases: string[],
  path: RegExp,
): string | undefined {
  const id = string(data, key)
  if (id) return id
  for (const alias of aliases) {
    const url = knownPlatformUrl(data[alias])
    const match = url && path.exec(url.pathname)
    if (match) {
      try {
        return decodeURIComponent(match[1]!)
      } catch {
        /* Invalid legacy encoding. */
      }
    }
  }
  return undefined
}

function requireIdentity(id: string | undefined, key: string): string {
  if (!id) throw new Error('EMAIL_DATA_MISSING:' + key)
  return id
}

function assertLink(
  data: EmailData,
  key: string,
  role: PlatformAudience,
  path: RegExp,
  allowedQuery: string[] = [],
): void {
  const url = knownPlatformUrl(data[key])
  if (
    !url ||
    url.origin !== getPlatformBaseUrls()[role] ||
    !path.test(url.pathname) ||
    [...url.searchParams.keys()].some((key) => !allowedQuery.includes(key))
  )
    throw new Error('EMAIL_LINK_INVALID:' + key)
}

/** Render-time normalization: old queue records are corrected without replaying sent mail. */
export function canonicalNotificationEmailData(
  type: NotificationType,
  original: EmailData | undefined,
): EmailData | undefined {
  if (!original) return original
  const data = { ...original }
  if (CUSTOMER_ORDER_TYPES.has(type)) {
    const orderId = requireIdentity(
      identity(
        data,
        'orderId',
        ['orderUrl', 'customerOrderUrl', 'orderLink'],
        /^\/siparis\/([^/]+)\/?$/,
      ),
      'orderId',
    )
    data.orderId = orderId
    data.orderUrl = getCustomerOrderUrl(orderId)
    if (type === 'order_placed' || data.contracts)
      data.contracts = getCustomerContractLinks(orderId)
    if (type === 'invoice_uploaded' && data.invoiceUrl) {
      const sellerId = string(data, 'sellerId')
      if (sellerId) data.invoiceUrl = getCustomerInvoiceUrl(orderId, sellerId)
      else
        assertLink(
          data,
          'invoiceUrl',
          'customer',
          /^\/api\/orders\/[^/]+\/documents\/invoices\/[^/]+$/,
        )
    }
  }
  if (type === 'seller_order_received' || type === 'order_canceled') {
    const orderId = requireIdentity(
      identity(
        data,
        'orderId',
        ['panelUrl', 'sellerPanelUrl', 'panelLink'],
        /^\/siparisler\/([^/]+)\/?$/,
      ),
      'orderId',
    )
    data.panelUrl = getSellerOrderUrl(orderId)
  }
  if (type === 'seller_return_request') {
    const returnId = requireIdentity(
      string(data, 'returnRequestId') ||
        string(data, 'operationId') ||
        identity(data, 'returnRequestId', ['panelUrl'], /^\/iadeler\/([^/]+)\/?$/),
      'returnRequestId',
    )
    data.panelUrl = getPlatformLink('seller', '/iadeler/' + encodeURIComponent(returnId))
  }
  if (type === 'customer_product_question_answered' || type === 'seller_product_question') {
    const customer = type === 'customer_product_question_answered'
    const key = customer ? 'threadUrl' : 'panelUrl'
    const prefix = customer ? '/hesabim/sorularim/' : '/musteri-sorulari/'
    const path = customer
      ? /^\/hesabim\/sorularim\/([^/]+)\/?$/
      : /^\/musteri-sorulari\/([^/]+)\/?$/
    const threadId = requireIdentity(identity(data, 'threadId', [key], path), 'threadId')
    data[key] = getPlatformLink(
      customer ? 'customer' : 'seller',
      prefix + encodeURIComponent(threadId),
    )
  }
  if (type === 'seller_announcement') {
    data.panelUrl = getPlatformLink(
      'seller',
      '/duyurular/' +
        encodeURIComponent(requireIdentity(string(data, 'announcementId'), 'announcementId')),
    )
  }
  if (type === 'product_price_drop' || type === 'product_discount_in_cart') {
    const productSlug = requireIdentity(
      identity(data, 'productSlug', ['productUrl'], /^\/urun\/([^/]+)\/?$/),
      'productSlug',
    )
    const legacy = knownPlatformUrl(data.productUrl)
    const productUrl = new URL(
      getPlatformLink('customer', '/urun/' + encodeURIComponent(productSlug)),
    )
    const variantId = string(data, 'variantId') || legacy?.searchParams.get('varyant')
    if (variantId) productUrl.searchParams.set('varyant', variantId)
    data.productUrl = productUrl.toString()
  }
  if (type === 'seller_approved') data.panelUrl = getPlatformLink('seller', '/giris')
  if (type === 'seller_documents_requested')
    data.panelUrl = getPlatformLink('seller', '/basvuru/belgeler')
  if (ADMIN_PATHS[type]) assertLink(data, 'adminUrl', 'admin', ADMIN_PATHS[type]!)
  return data
}

/** Defense for direct callers and for future notification types added to the policy. */
export function validateNotificationEmailLinks(
  type: NotificationType,
  data: EmailData | undefined,
): void {
  if (!data) return
  if (CUSTOMER_ORDER_TYPES.has(type)) assertLink(data, 'orderUrl', 'customer', /^\/siparis\/[^/]+$/)
  const sellerPath =
    type === 'seller_return_request' ? /^\/iadeler\/[^/]+$/ : /^\/siparisler\/[^/]+$/
  if (
    type === 'seller_order_received' ||
    type === 'order_canceled' ||
    type === 'seller_return_request'
  )
    assertLink(data, 'panelUrl', 'seller', sellerPath)
  if (type === 'seller_product_question')
    assertLink(data, 'panelUrl', 'seller', /^\/musteri-sorulari\/[^/]+$/)
  if (type === 'customer_product_question_answered')
    assertLink(data, 'threadUrl', 'customer', /^\/hesabim\/sorularim\/[^/]+$/)
  if (type === 'seller_announcement') assertLink(data, 'panelUrl', 'seller', /^\/duyurular\/[^/]+$/)
  if (type === 'seller_approved') assertLink(data, 'panelUrl', 'seller', /^\/giris$/)
  if (type === 'seller_documents_requested')
    assertLink(data, 'panelUrl', 'seller', /^\/basvuru\/belgeler$/)
  if (type === 'product_price_drop' || type === 'product_discount_in_cart')
    assertLink(data, 'productUrl', 'customer', /^\/urun\/[^/]+$/, ['varyant'])
  if (ADMIN_PATHS[type]) assertLink(data, 'adminUrl', 'admin', ADMIN_PATHS[type]!)
}
