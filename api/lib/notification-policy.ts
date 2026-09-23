import type { NotificationType } from '@prisma/client'
import type { EmailFromCategory } from './mailer'

type EmailPolicy = {
  role: 'customer' | 'seller' | 'admin'
  category: EmailFromCategory
  required: readonly string[]
  /**
   * Some in-app event types are reused for several stages; only the listed
   * `stage` values produce e-mail, the rest stay in-app (delivery is `skipped`).
   */
  emailStages?: readonly string[]
  /**
   * Queue lane override. Without it `kampanya` mail goes to the bulk lane and
   * everything else to the transactional lane. A bulk lane only orders and paces
   * our own sending: the provider's daily quota is still shared with transactional mail.
   */
  lane?: 'transactional' | 'bulk'
}

/**
 * Admin operation e-mails are addressed to a configured operations mailbox rather
 * than to a user account, so their outbox rows carry this reserved id instead of a
 * user id. `NotificationOutbox.userId` has no foreign key, and the reserved value
 * keeps the `(userId, type, eventKey)` deduplication index working — a nullable
 * column would not, because PostgreSQL treats NULLs as distinct.
 */
export const OPS_RECIPIENT_ID = 'ops'

/**
 * The only notification types an ops row may carry. Being addressed to
 * `OPS_RECIPIENT_ID` is never on its own a licence to skip the user/role checks:
 * the dispatcher refuses any other type.
 */
export const ADMIN_OPERATION_TYPES: ReadonlySet<NotificationType> = new Set<
  NotificationType
>([
  'admin_order_cancellation',
  'admin_return_requested',
  'admin_dispute_opened',
  'admin_support_new_ticket',
  'admin_customer_support_new',
  'admin_bank_transfer_pending',
  'admin_fulfillment_risk',
  'admin_seller_application',
])

export function isAdminOperationType(type: NotificationType) {
  return ADMIN_OPERATION_TYPES.has(type)
}

// New business events are added here together with their templates in later phases.
export const EMAIL_POLICIES: Partial<Record<NotificationType, EmailPolicy>> = {
  order_placed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items'],
  },
  order_payment_confirmed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items'],
  },
  order_shipped: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items'],
  },
  order_delivery_confirmed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items'],
  },
  order_cancelled: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items', 'actorRole'],
  },
  return_requested: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber'],
  },
  return_status_changed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'stage'],
    emailStages: ['cargo_info_ready'],
  },
  order_return_approved: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items', 'decision'],
  },
  order_return_rejected: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'items', 'decision'],
  },
  order_canceled: {
    role: 'seller',
    category: 'noreply',
    required: ['orderNumber', 'sellerId', 'items'],
  },
  seller_order_received: {
    role: 'seller',
    category: 'noreply',
    required: ['orderNumber', 'sellerId', 'items'],
  },
  seller_product_question: {
    role: 'seller',
    category: 'noreply',
    required: ['sellerName', 'productName', 'messageExcerpt', 'panelUrl'],
  },
  customer_product_question_answered: {
    role: 'customer',
    category: 'noreply',
    required: ['sellerName', 'productName', 'messageExcerpt', 'threadUrl'],
  },
  // Admin → seller operational announcement (phase 5). Sent in volume, so it uses the
  // bulk lane to keep order e-mails moving, but it is not marketing: no consent gate
  // and no List-Unsubscribe. The content is loaded from the frozen announcement row.
  seller_announcement: {
    role: 'seller',
    category: 'noreply',
    lane: 'bulk',
    required: ['announcementId', 'sellerName', 'panelUrl'],
  },
  seller_return_request: {
    role: 'seller',
    category: 'noreply',
    required: ['orderNumber', 'sellerId', 'items'],
  },
  refund_completed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber', 'refundAmount'],
  },
  payout_paid: {
    role: 'seller',
    category: 'noreply',
    required: ['payoutAmount'],
  },
  penalty_applied: {
    role: 'seller',
    category: 'noreply',
    required: ['orderNumber', 'penaltyAmount'],
  },
  invoice_uploaded: {
    role: 'customer',
    category: 'fatura',
    required: ['orderNumber', 'orderUrl'],
  },
  store_discount_followed_seller: {
    role: 'customer',
    category: 'kampanya',
    required: ['storeUrl', 'unsubscribeUrl'],
  },
  product_discount_favorited: {
    role: 'customer',
    category: 'kampanya',
    required: ['productUrl', 'unsubscribeUrl'],
  },
  product_discount_in_cart: {
    role: 'customer',
    category: 'kampanya',
    required: ['productUrl', 'unsubscribeUrl'],
  },
  // Admin operation events: e-mail goes to the configured operations mailbox only.
  // Their per-admin in-app copies stay in-app (see the dispatcher's ops branch).
  admin_order_cancellation: {
    role: 'admin',
    category: 'noreply',
    required: ['orderNumber', 'adminUrl'],
  },
  admin_return_requested: {
    role: 'admin',
    category: 'noreply',
    required: ['orderNumber', 'adminUrl'],
  },
  admin_dispute_opened: {
    role: 'admin',
    category: 'noreply',
    required: ['orderNumber', 'adminUrl'],
  },
  admin_support_new_ticket: {
    role: 'admin',
    category: 'noreply',
    required: ['subject', 'adminUrl'],
  },
  admin_customer_support_new: {
    role: 'admin',
    category: 'noreply',
    required: ['subject', 'adminUrl'],
  },
  admin_bank_transfer_pending: {
    role: 'admin',
    category: 'noreply',
    required: ['orderNumber', 'adminUrl'],
  },
  admin_fulfillment_risk: {
    role: 'admin',
    category: 'noreply',
    required: ['orderNumber', 'riskLevel', 'adminUrl'],
  },
  admin_seller_application: {
    role: 'admin',
    category: 'noreply',
    required: ['sellerName', 'adminUrl'],
  },
}

export function notificationLane(type: string): 'transactional' | 'bulk' {
  const policy = EMAIL_POLICIES[type as NotificationType]
  if (policy?.lane) return policy.lane
  return policy?.category === 'kampanya' ? 'bulk' : 'transactional'
}

/** True when the event stage is one that has an e-mail template (or the type has no stage gating). */
export function isEmailStage(
  type: NotificationType,
  data: Record<string, unknown> | undefined,
): boolean {
  const policy = EMAIL_POLICIES[type]
  if (!policy?.emailStages) return true
  return policy.emailStages.includes(String(data?.['stage'] ?? ''))
}

export function validateEmailData(
  type: NotificationType,
  data: Record<string, unknown> | undefined,
) {
  const policy = EMAIL_POLICIES[type]
  if (!policy) throw new Error('EMAIL_TEMPLATE_UNSUPPORTED')
  for (const key of policy.required) {
    const value = data?.[key]
    if (
      value == null ||
      value === '' ||
      (key === 'items' && (!Array.isArray(value) || !value.length))
    ) {
      throw new Error(`EMAIL_DATA_MISSING:${key}`)
    }
  }
  return policy
}

// Do not persist provider responses: they can contain recipients or credentials.
export function notificationErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/^(EMAIL_|SMTP_CONFIG_|SMTP_PORT_)/.test(message))
    return message.slice(0, 200)
  const code = (error as { code?: string; responseCode?: number } | null)?.code
  const response = (error as { responseCode?: number } | null)?.responseCode
  return `SEND_FAILED${code && /^[A-Z_]+$/.test(code) ? `:${code}` : ''}${response ? `:${response}` : ''}`
}
