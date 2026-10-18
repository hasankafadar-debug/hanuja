import { getPlatformBaseUrls } from './platform-info'

export type NotificationPanel = 'admin' | 'seller'

interface Destination {
  section: string
  ids?: string[]
  fallback?: string
}

const ADMIN_DESTINATIONS: Record<string, Destination> = {
  order_canceled: { section: '/siparisler', ids: ['orderId'] },
  order_cancelled: { section: '/siparisler', ids: ['orderId'] },
  admin_customer_support_new: { section: '/musteri-destek', ids: ['ticketId'] },
  admin_customer_support_reply: {
    section: '/musteri-destek',
    ids: ['ticketId'],
  },
  admin_order_cancellation: { section: '/siparisler', ids: ['orderId'] },
  admin_fulfillment_risk: { section: '/siparisler', ids: ['orderId'] },
  admin_return_requested: {
    section: '/iadeler',
    ids: ['returnRequestId', 'returnId'],
  },
  admin_dispute_opened: { section: '/uyusmazliklar', ids: ['disputeId'] },
  admin_bank_transfer_pending: {
    section: '/odemeler',
    fallback: '/odemeler?method=eft&status=pending',
  },
  admin_seller_application: { section: '/saticilar', ids: ['sellerId'] },
  product_review_pending_moderation: { section: '/yorumlar' },
}

const SELLER_DESTINATIONS: Record<string, Destination> = {
  seller_product_question: { section: '/musteri-sorulari', ids: ['threadId'] },
  seller_support_reply: { section: '/destek', ids: ['ticketId'] },
  seller_announcement: { section: '/duyurular', ids: ['announcementId'] },
  seller_order_received: { section: '/siparisler', ids: ['orderId'] },
  order_canceled: { section: '/siparisler', ids: ['orderId'] },
  order_cancelled: { section: '/siparisler', ids: ['orderId'] },
  fulfillment_warning_5days: { section: '/siparisler', ids: ['orderId'] },
  seller_invoice_reminder: { section: '/siparisler', ids: ['orderId'] },
  seller_invoice_rejected: { section: '/siparisler', ids: ['orderId'] },
  seller_refund_completed: { section: '/siparisler', ids: ['orderId'] },
  seller_penalty_applied: { section: '/siparisler', ids: ['orderId'] },
  penalty_applied: { section: '/siparisler', ids: ['orderId'] },
  dispute_opened: { section: '/siparisler', ids: ['orderId'] },
  dispute_resolved: { section: '/siparisler', ids: ['orderId'] },
  seller_return_request: {
    section: '/iadeler',
    ids: ['returnRequestId', 'returnId', 'operationId'],
  },
  seller_return_shipped: {
    section: '/iadeler',
    ids: ['returnRequestId', 'returnId', 'operationId'],
  },
  seller_return_decision: {
    section: '/iadeler',
    ids: ['returnRequestId', 'returnId', 'operationId'],
  },
  seller_return_invoice_uploaded: {
    section: '/iadeler',
    ids: ['returnRequestId', 'returnId', 'operationId'],
  },
  seller_payout_ready: { section: '/odemeler' },
  seller_payout_paid: { section: '/odemeler' },
  payout_ready: { section: '/odemeler' },
  payout_paid: { section: '/odemeler' },
  seller_approved: { section: '/dashboard' },
  seller_suspended: { section: '/dashboard' },
  account_verified: { section: '/dashboard' },
  seller_documents_requested: {
    section: '/ayarlar',
    fallback: '/ayarlar?tab=documents',
  },
  seller_bank_detail_pending: {
    section: '/ayarlar',
    fallback: '/ayarlar?tab=bank',
  },
  seller_bank_detail_approved: {
    section: '/ayarlar',
    fallback: '/ayarlar?tab=bank',
  },
  seller_bank_detail_activated: {
    section: '/ayarlar',
    fallback: '/ayarlar?tab=bank',
  },
  seller_bank_detail_blocked: {
    section: '/ayarlar',
    fallback: '/ayarlar?tab=bank',
  },
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

/** Resolve old and new records at read time; never navigate to an arbitrary payload URL. */
export function notificationHref(
  panel: NotificationPanel,
  notification: { type: string; data?: unknown },
): string | null {
  const data =
    notification.data && typeof notification.data === 'object' && !Array.isArray(notification.data)
      ? (notification.data as Record<string, unknown>)
      : {}
  const rule =
    panel === 'admin' && notification.type === 'admin_support_new_ticket'
      ? identifier(data.threadId)
        ? { section: '/musteri-sorulari', ids: ['threadId'] }
        : { section: '/destek', ids: ['ticketId'] }
      : (panel === 'admin' ? ADMIN_DESTINATIONS : SELLER_DESTINATIONS)[notification.type]
  if (!rule) return null

  for (const key of rule.ids ?? []) {
    if (identifier(data[key])) return `${rule.section}/${encodeURIComponent(data[key])}`
  }
  // A legacy product-question notification may only carry adminUrl.
  const sections =
    panel === 'admin' && notification.type === 'admin_support_new_ticket'
      ? ['/musteri-sorulari', '/destek']
      : [rule.section]
  const origin = getPlatformBaseUrls()[panel]
  const raw = data[panel === 'admin' ? 'adminUrl' : 'panelUrl']
  if (typeof raw === 'string' && raw.length <= 2048 && !/[\\\u0000-\u0020]/.test(raw)) {
    try {
      const url = new URL(raw, origin)
      const validPath = sections.some(
        (section) =>
          url.pathname === section ||
          ((rule.ids?.length || sections.length > 1) &&
            url.pathname.startsWith(section + '/') &&
            identifier(url.pathname.slice(section.length + 1))),
      )
      if (
        url.origin === origin &&
        !url.username &&
        !url.password &&
        !url.hash &&
        validPath &&
        [...url.searchParams.keys()].every((key) =>
          ['status', 'durum', 'method', 'tab'].includes(key),
        )
      ) {
        return url.pathname + url.search
      }
    } catch {
      /* Fall back to the matching section for incomplete legacy data. */
    }
  }
  return rule.fallback ?? rule.section
}
