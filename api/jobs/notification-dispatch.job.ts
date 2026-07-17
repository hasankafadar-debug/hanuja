/**
 * Notification Dispatch Job â€” sends in-app and email notifications.
 * Idempotent: deduplication is handled by the notification record's existence.
 */
import { NotificationType as NotificationTypeEnum } from '@prisma/client'
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { sendEmail, type EmailFromCategory } from '../lib/mailer'
import { PLATFORM_LEGAL_INFO } from '../lib/platform-info'
import {
  orderConfirmationTemplate,
  shipmentNotificationTemplate,
  deliveryConfirmedTemplate,
  invoiceUploadedTemplate,
  returnRequestTemplate,
  payoutProcessedTemplate,
  penaltyAppliedTemplate,
  storeDiscountFollowedSellerTemplate,
  productDiscountTemplate,
} from '../lib/email-templates'

type CanonicalNotificationType = (typeof NotificationTypeEnum)[keyof typeof NotificationTypeEnum]
type LegacyNotificationType = 'order_confirmed' | 'payout_processed'

export interface NotificationDispatchJobData {
  userId: string
  type: CanonicalNotificationType | LegacyNotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  /** If set, send email to this address in addition to in-app notification */
  emailTo?: string
  replyTo?: string
}

/** Notification types that warrant an email */
const EMAIL_NOTIFICATION_TYPES = new Set<CanonicalNotificationType>([
  NotificationTypeEnum.order_placed,
  NotificationTypeEnum.order_shipped,
  NotificationTypeEnum.order_delivery_confirmed,
  NotificationTypeEnum.return_requested,
  NotificationTypeEnum.payout_paid,
  NotificationTypeEnum.penalty_applied,
  NotificationTypeEnum.invoice_uploaded,
  NotificationTypeEnum.store_discount_followed_seller,
  NotificationTypeEnum.product_discount_favorited,
  NotificationTypeEnum.product_discount_in_cart,
])

/** Maps notification types to the from-address category used for their email. */
const EMAIL_CATEGORY_BY_TYPE: Record<string, EmailFromCategory> = {
  invoice_uploaded: 'fatura',
  store_discount_followed_seller: 'kampanya',
  product_discount_favorited: 'kampanya',
  product_discount_in_cart: 'kampanya',
}

function resolveEmailFromCategory(type: CanonicalNotificationType): EmailFromCategory {
  return EMAIL_CATEGORY_BY_TYPE[type] ?? 'noreply'
}

function normalizeNotificationType(type: string) {
  return type.trim().replace(/-/g, '_').toUpperCase()
}

const CANONICAL_NOTIFICATION_TYPE_LOOKUP = new Map<string, CanonicalNotificationType>(
  Object.values(NotificationTypeEnum).map((type) => [normalizeNotificationType(type), type]),
)

const LEGACY_NOTIFICATION_TYPE_ALIASES: Record<string, CanonicalNotificationType> = {
  ORDER_CONFIRMED: NotificationTypeEnum.order_placed,
  PAYOUT_PROCESSED: NotificationTypeEnum.payout_paid,
}

export function resolveNotificationType(type: string): CanonicalNotificationType | null {
  const normalizedType = normalizeNotificationType(type)
  return (
    LEGACY_NOTIFICATION_TYPE_ALIASES[normalizedType] ??
    CANONICAL_NOTIFICATION_TYPE_LOOKUP.get(normalizedType) ??
    null
  )
}

async function buildEmailPayload(
  type: CanonicalNotificationType,
  data: Record<string, unknown> | undefined,
): Promise<{ subject: string; html: string; text: string } | null> {
  if (!data) return null

  switch (type) {
    case NotificationTypeEnum.order_placed:
      return orderConfirmationTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        totalAmount: String(data['totalAmount'] ?? ''),
        items: (data['items'] as Array<{ name: string; quantity: number; price: string }>) ?? [],
        paymentMethod: data['paymentMethod'] === 'eft' ? 'eft' : 'card',
        ...((data['bankTransferInstructions'] as {
          bankName: string
          accountHolder: string
          iban: string
          reference: string
          missing?: boolean
        } | undefined)
          ? {
              bankTransferInstructions: data['bankTransferInstructions'] as {
                bankName: string
                accountHolder: string
                iban: string
                reference: string
                missing?: boolean
              },
            }
          : {}),
      })

    case NotificationTypeEnum.order_shipped:
      return shipmentNotificationTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        trackingNumber: String(data['trackingNumber'] ?? ''),
        cargoCompany: String(data['cargoCompany'] ?? ''),
      })

    case NotificationTypeEnum.order_delivery_confirmed:
      return deliveryConfirmedTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
      })

    case NotificationTypeEnum.return_requested:
      return returnRequestTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        returnReason: String(data['returnReason'] ?? ''),
      })

    case NotificationTypeEnum.payout_paid:
    case NotificationTypeEnum.seller_payout_paid:
      return payoutProcessedTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        payoutAmount: String(data['payoutAmount'] ?? ''),
        payoutDate: String(data['payoutDate'] ?? ''),
        periodDescription: String(data['periodDescription'] ?? ''),
      })

    case NotificationTypeEnum.penalty_applied:
    case NotificationTypeEnum.seller_penalty_applied:
      return penaltyAppliedTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        penaltyAmount: String(data['penaltyAmount'] ?? ''),
        penaltyReason: String(data['penaltyReason'] ?? ''),
      })

    case NotificationTypeEnum.invoice_uploaded:
      return invoiceUploadedTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        orderUrl: String(data['orderUrl'] ?? ''),
      })

    case NotificationTypeEnum.store_discount_followed_seller:
      return storeDiscountFollowedSellerTemplate({
        customerName: String(data['customerName'] ?? 'Değerli Müşterimiz'),
        sellerName: String(data['sellerName'] ?? 'Takip ettiğiniz mağaza'),
        storeUrl: String(data['storeUrl'] ?? ''),
        unsubscribeUrl: String(data['unsubscribeUrl'] ?? ''),
      })

    case NotificationTypeEnum.product_discount_favorited:
    case NotificationTypeEnum.product_discount_in_cart:
      return productDiscountTemplate({
        customerName: String(data['customerName'] ?? 'Değerli Müşterimiz'),
        productName: String(data['productName'] ?? ''),
        productUrl: String(data['productUrl'] ?? ''),
        sellerName: String(data['sellerName'] ?? ''),
        context: type === NotificationTypeEnum.product_discount_favorited ? 'favorite' : 'cart',
        unsubscribeUrl: String(data['unsubscribeUrl'] ?? ''),
      })

    default:
      return null
  }
}

export async function processNotificationDispatch(job: Job<NotificationDispatchJobData>) {
  const { userId, type, title, body, data, emailTo, replyTo } = job.data
  const canonicalType = resolveNotificationType(type)

  if (!canonicalType) {
    console.warn('[notification-dispatch] Skipping notification with invalid type.', {
      jobId: job.id,
      type,
      userId,
    })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  })

  if (!user) {
    console.warn('[notification-dispatch] Skipping notification for missing user.', {
      jobId: job.id,
      type: canonicalType,
      userId,
    })
    return
  }

  await prisma.notification.create({
    data: {
      userId: user.id,
      type: canonicalType,
      title,
      body,
      data: data as never,
    },
  })

  if (emailTo && EMAIL_NOTIFICATION_TYPES.has(canonicalType)) {
    const emailPayload = await buildEmailPayload(canonicalType, data)
    if (emailPayload) {
      const fromCategory = resolveEmailFromCategory(canonicalType)
      // Invoice emails should route replies to support unless the sender set one.
      const resolvedReplyTo =
        replyTo ?? (fromCategory === 'fatura' ? PLATFORM_LEGAL_INFO.supportEmail : undefined)
      // Kampanya (marketing) emails carry a one-click List-Unsubscribe header when
      // an unsubscribe URL is present, so inbox providers can offer native opt-out.
      const unsubscribeUrl = String(data?.['unsubscribeUrl'] ?? '')
      const listUnsubscribeHeaders =
        fromCategory === 'kampanya' && unsubscribeUrl
          ? {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : undefined
      try {
        await sendEmail({
          to: emailTo,
          ...emailPayload,
          fromCategory,
          ...(resolvedReplyTo ? { replyTo: resolvedReplyTo } : {}),
          ...(listUnsubscribeHeaders ? { headers: listUnsubscribeHeaders } : {}),
        })
      } catch (err) {
        console.error(`[notification-dispatch] Email send failed for ${canonicalType}:`, err)
      }
    }
  }

  console.log(`[notification-dispatch] Dispatched to user ${userId}: ${canonicalType}`)
}

export function startNotificationDispatchWorker() {
  const worker = new Worker<NotificationDispatchJobData>(
    QUEUE_NAMES.NOTIFICATION_DISPATCH,
    processNotificationDispatch,
    { connection: redis, concurrency: 5 },
  )

  worker.on('failed', (job: { id?: string } | undefined, err: Error) => {
    console.error(`[notification-dispatch] Job ${job?.id} failed:`, err)
  })

  return worker
}

/**
 * Helper: enqueue a notification from any service.
 */
export async function enqueueNotification(data: NotificationDispatchJobData) {
  const { notificationDispatchQueue } = await import('../lib/queue')
  return notificationDispatchQueue.add('notify', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  })
}
