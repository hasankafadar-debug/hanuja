import type { NotificationType } from '@prisma/client'
import type { EmailFromCategory } from './mailer'

type EmailPolicy = {
  role: 'customer' | 'seller'
  category: EmailFromCategory
  required: readonly string[]
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
    required: ['orderNumber'],
  },
  order_shipped: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber'],
  },
  order_delivery_confirmed: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber'],
  },
  return_requested: {
    role: 'customer',
    category: 'noreply',
    required: ['orderNumber'],
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
}

export function notificationLane(type: string): 'transactional' | 'bulk' {
  return EMAIL_POLICIES[type as NotificationType]?.category === 'kampanya'
    ? 'bulk'
    : 'transactional'
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
