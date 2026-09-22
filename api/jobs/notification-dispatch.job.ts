/**
 * Notification Dispatch Job â€” sends in-app and email notifications.
 * Idempotent: deduplication is handled by the notification record's existence.
 */
import { NotificationType as NotificationTypeEnum } from '@prisma/client'
import { Worker, Job } from 'bullmq'
import { createHash, randomUUID } from 'node:crypto'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { sendEmail } from '../lib/mailer'
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
  orderPaymentConfirmedTemplate,
  sellerNewOrderTemplate,
  sellerOrderCancellationTemplate,
  sellerReturnRequestTemplate,
  refundCompletedTemplate,
} from '../lib/email-templates'

type CanonicalNotificationType =
  (typeof NotificationTypeEnum)[keyof typeof NotificationTypeEnum]
type LegacyNotificationType = 'order_confirmed' | 'payout_processed'

export interface NotificationDispatchJobData {
  eventKey?: string
  outboxId?: string
  generation?: number
  userId: string
  type: CanonicalNotificationType | LegacyNotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  /** If set, send email to this address in addition to in-app notification */
  emailTo?: string
  replyTo?: string
}

import {
  EMAIL_POLICIES,
  validateEmailData,
  notificationErrorCode,
} from '../lib/notification-policy'
import { recordNotification } from '../services/notification-outbox.service'

function normalizeNotificationType(type: string) {
  return type.trim().replace(/-/g, '_').toUpperCase()
}

const CANONICAL_NOTIFICATION_TYPE_LOOKUP = new Map<
  string,
  CanonicalNotificationType
>(
  Object.values(NotificationTypeEnum).map((type) => [
    normalizeNotificationType(type),
    type,
  ]),
)

const LEGACY_NOTIFICATION_TYPE_ALIASES: Record<
  string,
  CanonicalNotificationType
> = {
  ORDER_CONFIRMED: NotificationTypeEnum.order_placed,
  PAYOUT_PROCESSED: NotificationTypeEnum.payout_paid,
}

export function resolveNotificationType(
  type: string,
): CanonicalNotificationType | null {
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
        items:
          (data['items'] as Array<{
            productName: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['orderUrl'] ? { orderUrl: String(data['orderUrl']) } : {}),
        paymentMethod: data['paymentMethod'] === 'eft' ? 'eft' : 'card',
        ...((data['bankTransferInstructions'] as
          | {
              bankName: string
              accountHolder: string
              iban: string
              reference: string
              missing?: boolean
            }
          | undefined)
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

    case NotificationTypeEnum.order_payment_confirmed:
      return orderPaymentConfirmedTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['totalAmount'] !== undefined
          ? { totalAmount: String(data['totalAmount']) }
          : {}),
        ...(data['orderUrl'] ? { orderUrl: String(data['orderUrl']) } : {}),
        paymentMethod: data['paymentMethod'] === 'eft' ? 'eft' : 'card',
      })

    case NotificationTypeEnum.seller_order_received:
      return sellerNewOrderTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        sellerId: String(data['sellerId'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            sellerId?: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['totalAmount'] !== undefined
          ? { totalAmount: String(data['totalAmount']) }
          : {}),
        ...(data['panelUrl'] ? { panelUrl: String(data['panelUrl']) } : {}),
      })

    case NotificationTypeEnum.order_canceled:
      return sellerOrderCancellationTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        sellerId: String(data['sellerId'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            sellerId?: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['cancellationReason']
          ? { cancellationReason: String(data['cancellationReason']) }
          : {}),
        ...(data['panelUrl'] ? { panelUrl: String(data['panelUrl']) } : {}),
      })

    case NotificationTypeEnum.seller_return_request:
      return sellerReturnRequestTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        sellerId: String(data['sellerId'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            sellerId?: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['returnReason']
          ? { returnReason: String(data['returnReason']) }
          : {}),
        ...(data['panelUrl'] ? { panelUrl: String(data['panelUrl']) } : {}),
      })

    case NotificationTypeEnum.refund_completed:
      return refundCompletedTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['refundAmount'] !== undefined
          ? { refundAmount: String(data['refundAmount']) }
          : {}),
        ...(data['orderUrl'] ? { orderUrl: String(data['orderUrl']) } : {}),
      })

    case NotificationTypeEnum.order_shipped:
      return shipmentNotificationTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        trackingNumber: String(data['trackingNumber'] ?? ''),
        cargoCompany: String(data['cargoCompany'] ?? ''),
        items:
          (data['items'] as Array<{
            productName: string
            variantName?: string | null
            quantity: number
            unitPrice: string
            lineTotal: string
          }>) ?? [],
        ...(data['totalAmount'] !== undefined
          ? { totalAmount: String(data['totalAmount']) }
          : {}),
        ...(data['orderUrl'] ? { orderUrl: String(data['orderUrl']) } : {}),
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
        context:
          type === NotificationTypeEnum.product_discount_favorited
            ? 'favorite'
            : 'cart',
        unsubscribeUrl: String(data['unsubscribeUrl'] ?? ''),
      })

    default:
      return null
  }
}

export async function processNotificationDispatch(
  job: Job<NotificationDispatchJobData>,
) {
  const { prisma } = await import('../lib/prisma')
  const { userId, title, body, data, replyTo } = job.data
  const type = resolveNotificationType(job.data.type)
  if (!type) throw new Error('EMAIL_EVENT_UNKNOWN')
  if (type === NotificationTypeEnum.seller_refund_completed) return
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  })
  if (!user) throw new Error('EMAIL_USER_MISSING')
  const eventKey = job.data.eventKey ?? `legacy-job:${job.id ?? 'unknown'}`
  const payload = JSON.parse(JSON.stringify({ ...job.data, eventKey }))
  const now = new Date()
  const inApp = await prisma.notificationDelivery.upsert({
    where: {
      recipient_channel_eventKey: {
        recipient: userId,
        channel: 'in_app',
        eventKey,
      },
    },
    update: {},
    create: {
      eventKey,
      userId,
      type,
      channel: 'in_app',
      recipient: userId,
      payload,
    },
  })
  if (inApp.status !== 'sent') {
    // Claim + notification + sent marker commit together; crashes roll back the claim.
    await prisma.$transaction(async (tx) => {
      const claim = await tx.notificationDelivery.updateMany({
        where: {
          id: inApp.id,
          OR: [
            { status: { in: ['pending', 'failed'] } },
            {
              status: 'processing',
              OR: [{ leaseExpiresAt: { lt: now } }, { leaseExpiresAt: null }],
            },
          ],
        },
        data: {
          status: 'processing',
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
        },
      })
      if (!claim.count) return
      const notification = await tx.notification.create({
        data: { userId, type, title, body, data: data as never },
      })
      await tx.notificationDelivery.update({
        where: { id: inApp.id },
        data: {
          status: 'sent',
          notificationId: notification.id,
          deliveredAt: now,
        },
      })
    })
  }
  const policy = EMAIL_POLICIES[type]
  // Preserve deliberate in-app-only events; explicitly requested unsupported email is an error.
  if (!policy && !job.data.emailTo) return
  // Marketing producers intentionally omit emailTo for users who opted out.
  if (policy?.category === 'kampanya' && !job.data.emailTo) return
  const emailTo = (job.data.emailTo ?? user.email ?? '').trim().toLowerCase()
  const email = await prisma.notificationDelivery.upsert({
    where: {
      recipient_channel_eventKey: {
        recipient: emailTo || userId,
        channel: 'email',
        eventKey,
      },
    },
    update: {},
    create: {
      eventKey,
      userId,
      type,
      channel: 'email',
      recipient: emailTo || userId,
      payload,
    },
  })
  if (email.status === 'sent' || email.transportStatus === 'skipped') return
  if (email.transportStatus === 'uncertain')
    throw new Error('EMAIL_OUTCOME_UNCERTAIN_REVIEW_REQUIRED')
  if (email.status === 'processing') {
    if (!email.leaseExpiresAt || email.leaseExpiresAt < now) {
      await prisma.notificationDelivery.updateMany({
        where: {
          id: email.id,
          status: 'processing',
          leaseToken: email.leaseToken,
        },
        data: {
          status: 'failed',
          transportStatus: 'uncertain',
          lastError: 'SMTP_OUTCOME_UNCERTAIN',
          leaseToken: null,
        },
      })
    }
    throw new Error('EMAIL_DELIVERY_BUSY_OR_UNCERTAIN')
  }
  const token = randomUUID()
  const claim = await prisma.notificationDelivery.updateMany({
    where: {
      id: email.id,
      status: { in: ['pending', 'failed'] },
      transportStatus: { not: 'uncertain' },
    },
    data: {
      status: 'processing',
      leaseToken: token,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      lastAttemptAt: now,
      attemptCount: { increment: 1 },
      lastError: null,
    },
  })
  if (!claim.count) throw new Error('EMAIL_DELIVERY_BUSY_OR_UNCERTAIN')
  let accepted = false
  try {
    const config = validateEmailData(type, data)
    if (user.role !== config.role)
      throw new Error('EMAIL_RECIPIENT_ROLE_MISMATCH')
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(emailTo))
      throw new Error('EMAIL_RECIPIENT_INVALID')
    if (config.category === 'kampanya') {
      const consent = await prisma.marketingConsent.findUnique({
        where: { userId },
      })
      if (!consent?.emailConsentAt || consent.emailRevokedAt) {
        await prisma.notificationDelivery.update({
          where: { id: email.id },
          data: {
            status: 'sent',
            transportStatus: 'skipped',
            lastError: 'MARKETING_CONSENT_MISSING',
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        return
      }
    }
    const template = await buildEmailPayload(type, data)
    if (!template) throw new Error('EMAIL_TEMPLATE_UNSUPPORTED')
    const messageId =
      email.messageId ??
      `<${createHash('sha256').update(email.id).digest('hex')}@hanuja.com.tr>`
    await prisma.notificationDelivery.update({
      where: { id: email.id },
      data: { messageId },
    })
    const unsubscribeUrl = String(data?.['unsubscribeUrl'] ?? '')
    const result = await sendEmail({
      to: emailTo,
      ...template,
      fromCategory: config.category,
      messageId,
      ...(replyTo
        ? { replyTo }
        : config.category === 'fatura'
          ? { replyTo: PLATFORM_LEGAL_INFO.supportEmail }
          : {}),
      headers: {
        ...(process.env.SMTP_HOST === 'smtp.resend.com'
          ? { 'Resend-Idempotency-Key': email.id }
          : {}),
        ...(config.category === 'kampanya'
          ? {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            }
          : {}),
      },
    })
    accepted = true
    await prisma.notificationDelivery.updateMany({
      where: { id: email.id, leaseToken: token },
      data: {
        status: 'sent',
        smtpAcceptedAt: result.transport === 'smtp' ? new Date() : null,
        providerMessageId: result.providerMessageId,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        ...(result.transport === 'development'
          ? { transportStatus: 'simulated' }
          : {}),
      },
    })
    const { reconcileEmailProviderEvents } =
      await import('../services/email-provider-event.service')
    await reconcileEmailProviderEvents(prisma, email.id)
  } catch (error) {
    const smtp = error as {
      code?: string
      command?: string
      responseCode?: number
    }
    const uncertain =
      accepted ||
      (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(smtp.code ?? '') &&
        (!smtp.command || smtp.command === 'DATA'))
    await prisma.notificationDelivery.updateMany({
      where: { id: email.id, leaseToken: token },
      data: {
        status: 'failed',
        transportStatus: uncertain ? 'uncertain' : 'unknown',
        lastError: uncertain
          ? 'SMTP_OUTCOME_UNCERTAIN'
          : notificationErrorCode(error),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    })
    throw error
  }
}

async function trackedDispatch(job: Job<NotificationDispatchJobData>) {
  const { prisma } = await import('../lib/prisma')
  try {
    await processNotificationDispatch(job)
    if (job.data.outboxId)
      await prisma.notificationOutbox.updateMany({
        where: { id: job.data.outboxId, generation: job.data.generation ?? 0 },
        data: { status: 'completed', lastError: null },
      })
  } catch (error) {
    if (job.data.outboxId)
      await prisma.notificationOutbox.updateMany({
        where: { id: job.data.outboxId, generation: job.data.generation ?? 0 },
        data: {
          ...(job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
            ? { status: 'failed' }
            : {}),
          lastError: notificationErrorCode(error),
        },
      })
    throw new Error(notificationErrorCode(error))
  }
}

export function startNotificationDispatchWorker() {
  const worker = new Worker<NotificationDispatchJobData>(
    QUEUE_NAMES.NOTIFICATION_DISPATCH,
    trackedDispatch,
    {
      connection: redis,
      concurrency: 2,
      limiter: { max: 1, duration: 1000 },
    },
  )
  worker.on('failed', (job, error) =>
    console.error(
      '[notification-dispatch]',
      job?.id,
      notificationErrorCode(error),
    ),
  )
  return worker
}

export function startNotificationBulkWorker() {
  const worker = new Worker<NotificationDispatchJobData>(
    QUEUE_NAMES.NOTIFICATION_BULK,
    trackedDispatch,
    {
      connection: redis,
      concurrency: 1,
      limiter: { max: 1, duration: 2000 },
    },
  )
  worker.on('failed', (job, error) =>
    console.error('[notification-bulk]', job?.id, notificationErrorCode(error)),
  )
  return worker
}

export async function enqueueNotification(data: NotificationDispatchJobData) {
  const { prisma } = await import('../lib/prisma')
  return recordNotification(prisma, data)
}
