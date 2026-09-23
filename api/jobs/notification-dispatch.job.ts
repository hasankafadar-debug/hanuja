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
  returnCargoInfoReadyTemplate,
  returnDecisionTemplate,
  customerOrderCancelledTemplate,
  payoutProcessedTemplate,
  penaltyAppliedTemplate,
  storeDiscountFollowedSellerTemplate,
  productDiscountTemplate,
  orderPaymentConfirmedTemplate,
  sellerNewOrderTemplate,
  sellerOrderCancellationTemplate,
  sellerReturnRequestTemplate,
  refundCompletedTemplate,
  adminBankTransferPendingTemplate,
  adminCustomerSupportTicketTemplate,
  adminDisputeOpenedTemplate,
  adminFulfillmentRiskTemplate,
  adminOrderCancellationTemplate,
  adminReturnRequestedTemplate,
  adminSellerApplicationTemplate,
  adminSellerSupportTicketTemplate,
  sellerProductQuestionTemplate,
  customerProductQuestionAnsweredTemplate,
  type BankTransferInstruction,
  type CancellationActorRole,
  type EmailOrderLineInput,
  type OrderAmountSummary,
  type OrderContractLinks,
  type RefundOutcome,
  type ReturnDecisionLine,
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
  ADMIN_OPERATION_TYPES,
  EMAIL_POLICIES,
  isEmailStage,
  OPS_RECIPIENT_ID,
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

const REFUND_OUTCOMES: readonly RefundOutcome[] = [
  'awaiting_return',
  'processing',
  'manual_review',
  'no_refund_due',
  'completed',
  'under_review',
]

type EmailData = Record<string, unknown>

function str(data: EmailData, key: string, fallback = ''): string {
  const value = data[key]
  return value === undefined || value === null ? fallback : String(value)
}

function optStr(data: EmailData, key: string): string | undefined {
  const value = data[key]
  return value === undefined || value === null || value === '' ? undefined : String(value)
}

function lines<T = EmailOrderLineInput>(data: EmailData, key = 'items'): T[] {
  const value = data[key]
  return Array.isArray(value) ? (value as T[]) : []
}

/** `{ key: value }` when present, `{}` otherwise — keeps optional props exact. */
function opt(data: EmailData, key: string, as = key): Record<string, string> {
  const value = optStr(data, key)
  return value === undefined ? {} : { [as]: value }
}

function optNum(data: EmailData, key: string): Record<string, number> {
  const value = data[key]
  return typeof value === 'number' && Number.isFinite(value) ? { [key]: value } : {}
}

function paymentMethod(data: EmailData): 'card' | 'eft' | undefined {
  const value = data['paymentMethod']
  return value === 'eft' ? 'eft' : value === 'card' ? 'card' : undefined
}

function amountSummary(data: EmailData): OrderAmountSummary | undefined {
  const value = data['summary']
  return value && typeof value === 'object' ? (value as OrderAmountSummary) : undefined
}

function contractLinks(data: EmailData): OrderContractLinks {
  const value = data['contracts']
  return value && typeof value === 'object' ? (value as OrderContractLinks) : {}
}

async function buildEmailPayload(
  type: CanonicalNotificationType,
  data: EmailData | undefined,
): Promise<{ subject: string; html: string; text: string } | null> {
  if (!data) return null

  switch (type) {
    case NotificationTypeEnum.order_placed: {
      const method = paymentMethod(data) ?? 'card'
      const summary = amountSummary(data)
      return orderConfirmationTemplate({
        customerName: str(data, 'customerName'),
        orderNumber: str(data, 'orderNumber'),
        totalAmount: str(data, 'totalAmount'),
        items: lines(data),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
        paymentMethod: method,
        paymentStatus:
          data['paymentStatus'] === 'confirmed'
            ? 'confirmed'
            : method === 'eft'
              ? 'pending'
              : 'confirmed',
        ...(data['bankTransferInstructions']
          ? {
              bankTransferInstructions: data['bankTransferInstructions'] as
                | BankTransferInstruction
                | BankTransferInstruction[],
            }
          : {}),
        ...(summary ? { summary } : {}),
        contracts: contractLinks(data),
      })
    }

    case NotificationTypeEnum.order_payment_confirmed:
      return orderPaymentConfirmedTemplate({
        customerName: str(data, 'customerName'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'totalAmount') ? { totalAmount: optStr(data, 'totalAmount')! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
        ...(paymentMethod(data) ? { paymentMethod: paymentMethod(data)! } : {}),
      })

    case NotificationTypeEnum.seller_order_received:
      return sellerNewOrderTemplate({
        sellerName: str(data, 'sellerName'),
        sellerId: str(data, 'sellerId'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'totalAmount') ? { totalAmount: optStr(data, 'totalAmount')! } : {}),
        ...(optStr(data, 'panelUrl') ? { panelUrl: optStr(data, 'panelUrl')! } : {}),
      })

    case NotificationTypeEnum.order_canceled:
      return sellerOrderCancellationTemplate({
        sellerName: str(data, 'sellerName'),
        sellerId: str(data, 'sellerId'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'cancellationReason')
          ? { cancellationReason: optStr(data, 'cancellationReason')! }
          : {}),
        ...(optStr(data, 'actorRole')
          ? { actorRole: str(data, 'actorRole') as CancellationActorRole }
          : {}),
        partial: data['partial'] === true,
        ...(optStr(data, 'panelUrl') ? { panelUrl: optStr(data, 'panelUrl')! } : {}),
      })

    case NotificationTypeEnum.order_cancelled:
      return customerOrderCancelledTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        partial: data['partial'] === true,
        actorRole: str(data, 'actorRole', 'system') as CancellationActorRole,
        ...(optStr(data, 'cancellationReason')
          ? { reason: optStr(data, 'cancellationReason')! }
          : {}),
        ...(optStr(data, 'refundAmount') ? { refundAmount: optStr(data, 'refundAmount')! } : {}),
        ...(paymentMethod(data) ? { paymentMethod: paymentMethod(data)! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.seller_return_request:
      return sellerReturnRequestTemplate({
        sellerName: str(data, 'sellerName'),
        sellerId: str(data, 'sellerId'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'returnReason') ? { returnReason: optStr(data, 'returnReason')! } : {}),
        ...(optStr(data, 'panelUrl') ? { panelUrl: optStr(data, 'panelUrl')! } : {}),
      })

    case NotificationTypeEnum.seller_product_question:
      return sellerProductQuestionTemplate({
        sellerName: str(data, 'sellerName'),
        productName: str(data, 'productName'),
        messageExcerpt: str(data, 'messageExcerpt'),
        panelUrl: str(data, 'panelUrl'),
        ...opt(data, 'productImageUrl'),
        ...opt(data, 'customerName'),
        ...opt(data, 'orderNumber'),
      })

    case NotificationTypeEnum.seller_announcement: {
      // The payload only names the announcement: the frozen content is read at send
      // time, so thousands of rows do not each carry a copy of the text.
      const { prisma } = await import('../lib/prisma')
      const { loadSentAnnouncementEmail } = await import('../services/announcement-content')
      return loadSentAnnouncementEmail(prisma, str(data, 'announcementId'), {
        sellerName: str(data, 'sellerName'),
        panelUrl: str(data, 'panelUrl'),
      })
    }

    case NotificationTypeEnum.customer_product_question_answered:
      return customerProductQuestionAnsweredTemplate({
        sellerName: str(data, 'sellerName'),
        productName: str(data, 'productName'),
        messageExcerpt: str(data, 'messageExcerpt'),
        threadUrl: str(data, 'threadUrl'),
        ...opt(data, 'productImageUrl'),
        ...opt(data, 'customerName'),
        ...opt(data, 'orderNumber'),
      })

    case NotificationTypeEnum.refund_completed:
      return refundCompletedTemplate({
        customerName: str(data, 'customerName'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'refundAmount') ? { refundAmount: optStr(data, 'refundAmount')! } : {}),
        ...(paymentMethod(data) ? { paymentMethod: paymentMethod(data)! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.order_shipped:
      return shipmentNotificationTemplate({
        customerName: str(data, 'customerName'),
        orderNumber: str(data, 'orderNumber'),
        trackingNumber: str(data, 'trackingNumber'),
        cargoCompany: str(data, 'cargoCompany'),
        ...(optStr(data, 'trackingUrl') ? { trackingUrl: optStr(data, 'trackingUrl')! } : {}),
        ...(optStr(data, 'sellerName') ? { sellerName: optStr(data, 'sellerName')! } : {}),
        items: lines(data),
        ...(optStr(data, 'totalAmount') ? { totalAmount: optStr(data, 'totalAmount')! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.order_delivery_confirmed:
      return deliveryConfirmedTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        partial: data['partial'] === true,
        ...(optStr(data, 'confirmedAt') ? { confirmedAt: optStr(data, 'confirmedAt')! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.return_requested:
      return returnRequestTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        orderNumber: str(data, 'orderNumber'),
        returnReason: str(data, 'returnReason'),
        items: lines(data),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.return_status_changed:
      if (data['stage'] !== 'cargo_info_ready') return null
      return returnCargoInfoReadyTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        orderNumber: str(data, 'orderNumber'),
        items: lines(data),
        ...(optStr(data, 'cargoAddress') ? { cargoAddress: optStr(data, 'cargoAddress')! } : {}),
        ...(optStr(data, 'cargoCarrier') ? { cargoCarrier: optStr(data, 'cargoCarrier')! } : {}),
        ...(optStr(data, 'cargoInstructions')
          ? { cargoInstructions: optStr(data, 'cargoInstructions')! }
          : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })

    case NotificationTypeEnum.order_return_approved:
    case NotificationTypeEnum.order_return_rejected: {
      const decision = str(data, 'decision')
      if (decision !== 'approved' && decision !== 'partial' && decision !== 'rejected')
        return null
      const outcome = str(data, 'refundOutcome')
      return returnDecisionTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        orderNumber: str(data, 'orderNumber'),
        decision,
        // Unknown/legacy payloads fall back to the conservative wording rather
        // than claiming a refund is being processed.
        refundOutcome: REFUND_OUTCOMES.includes(outcome as RefundOutcome)
          ? (outcome as RefundOutcome)
          : 'under_review',
        items: lines<ReturnDecisionLine>(data),
        ...(optStr(data, 'refundAmount') ? { refundAmount: optStr(data, 'refundAmount')! } : {}),
        disputeOpened: data['disputeOpened'] === true,
        ...(optStr(data, 'reviewNote') ? { reviewNote: optStr(data, 'reviewNote')! } : {}),
        ...(optStr(data, 'orderUrl') ? { orderUrl: optStr(data, 'orderUrl')! } : {}),
      })
    }

    case NotificationTypeEnum.payout_paid:
    case NotificationTypeEnum.seller_payout_paid:
      return payoutProcessedTemplate({
        sellerName: str(data, 'sellerName'),
        payoutAmount: str(data, 'payoutAmount'),
        payoutDate: str(data, 'payoutDate'),
        periodDescription: str(data, 'periodDescription'),
      })

    case NotificationTypeEnum.penalty_applied:
    case NotificationTypeEnum.seller_penalty_applied:
      return penaltyAppliedTemplate({
        sellerName: str(data, 'sellerName'),
        orderNumber: str(data, 'orderNumber'),
        penaltyAmount: str(data, 'penaltyAmount'),
        penaltyReason: str(data, 'penaltyReason'),
      })

    case NotificationTypeEnum.invoice_uploaded:
      return invoiceUploadedTemplate({
        customerName: str(data, 'customerName'),
        orderNumber: str(data, 'orderNumber'),
        orderUrl: str(data, 'orderUrl'),
        ...(optStr(data, 'invoiceUrl') ? { invoiceUrl: optStr(data, 'invoiceUrl')! } : {}),
        ...(optStr(data, 'sellerName') ? { sellerName: optStr(data, 'sellerName')! } : {}),
        items: lines(data),
      })

    case NotificationTypeEnum.store_discount_followed_seller:
      return storeDiscountFollowedSellerTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        sellerName: str(data, 'sellerName', 'Takip ettiğiniz mağaza'),
        storeUrl: str(data, 'storeUrl'),
        unsubscribeUrl: str(data, 'unsubscribeUrl'),
      })

    case NotificationTypeEnum.product_discount_favorited:
    case NotificationTypeEnum.product_discount_in_cart:
      return productDiscountTemplate({
        customerName: str(data, 'customerName', 'Değerli Müşterimiz'),
        productName: str(data, 'productName'),
        productUrl: str(data, 'productUrl'),
        sellerName: str(data, 'sellerName'),
        context:
          type === NotificationTypeEnum.product_discount_favorited
            ? 'favorite'
            : 'cart',
        unsubscribeUrl: str(data, 'unsubscribeUrl'),
      })

    // --- Admin operation e-mails (phase 3) -------------------------------
    case NotificationTypeEnum.admin_order_cancellation:
      return adminOrderCancellationTemplate({
        orderNumber: str(data, 'orderNumber'),
        adminUrl: str(data, 'adminUrl'),
        items: lines(data),
        ...opt(data, 'actorLabel'),
        ...opt(data, 'sellerName'),
        ...opt(data, 'customerName'),
        ...opt(data, 'refundAmount'),
        ...opt(data, 'reason'),
      })

    case NotificationTypeEnum.admin_return_requested:
      return adminReturnRequestedTemplate({
        orderNumber: str(data, 'orderNumber'),
        adminUrl: str(data, 'adminUrl'),
        items: lines(data),
        ...opt(data, 'sellerName'),
        ...opt(data, 'customerName'),
        ...opt(data, 'reason'),
        ...opt(data, 'flowLabel'),
      })

    case NotificationTypeEnum.admin_dispute_opened:
      return adminDisputeOpenedTemplate({
        orderNumber: str(data, 'orderNumber'),
        adminUrl: str(data, 'adminUrl'),
        ...opt(data, 'sellerName'),
        ...opt(data, 'customerName'),
        ...opt(data, 'reason'),
        ...opt(data, 'sourceLabel'),
      })

    case NotificationTypeEnum.admin_support_new_ticket:
      return adminSellerSupportTicketTemplate({
        subject: str(data, 'subject'),
        adminUrl: str(data, 'adminUrl'),
        ...opt(data, 'ticketNumber'),
        ...opt(data, 'requesterName'),
        ...opt(data, 'categoryLabel'),
        ...opt(data, 'priorityLabel'),
        ...opt(data, 'message'),
      })

    case NotificationTypeEnum.admin_customer_support_new:
      return adminCustomerSupportTicketTemplate({
        subject: str(data, 'subject'),
        adminUrl: str(data, 'adminUrl'),
        ...opt(data, 'ticketNumber'),
        ...opt(data, 'requesterName'),
        ...opt(data, 'categoryLabel'),
        ...opt(data, 'priorityLabel'),
        ...opt(data, 'message'),
      })

    case NotificationTypeEnum.admin_bank_transfer_pending:
      return adminBankTransferPendingTemplate({
        orderNumber: str(data, 'orderNumber'),
        adminUrl: str(data, 'adminUrl'),
        ...opt(data, 'customerName'),
        ...opt(data, 'totalAmount'),
        ...opt(data, 'reference'),
        ...opt(data, 'bankName'),
      })

    case NotificationTypeEnum.admin_fulfillment_risk:
      return adminFulfillmentRiskTemplate({
        orderNumber: str(data, 'orderNumber'),
        adminUrl: str(data, 'adminUrl'),
        riskLevel: str(data, 'riskLevel'),
        items: lines(data),
        ...opt(data, 'sellerName'),
        ...opt(data, 'deadlineLabel'),
        ...optNum(data, 'overdueDays'),
      })

    case NotificationTypeEnum.admin_seller_application:
      return adminSellerApplicationTemplate({
        sellerName: str(data, 'sellerName'),
        adminUrl: str(data, 'adminUrl'),
        ...opt(data, 'companyName'),
        ...opt(data, 'city'),
        ...opt(data, 'taxNumber'),
        ...optNum(data, 'submissionSeq'),
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
  // Admin operation events are addressed to a configured mailbox, not to a user
  // account: no user row, no in-app notification, e-mail leg only.
  const isOps = userId === OPS_RECIPIENT_ID
  const user = isOps
    ? null
    : await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true },
      })
  if (!isOps && !user) throw new Error('EMAIL_USER_MISSING')
  const eventKey = job.data.eventKey ?? `legacy-job:${job.id ?? 'unknown'}`
  const payload = JSON.parse(JSON.stringify({ ...job.data, eventKey }))
  const now = new Date()
  const deliveryUserId = isOps ? null : userId
  if (!isOps) {
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
  }
  const policy = EMAIL_POLICIES[type]
  // Preserve deliberate in-app-only events; explicitly requested unsupported email is an error.
  if (!policy && !job.data.emailTo) return
  // Marketing producers intentionally omit emailTo for users who opted out.
  if (policy?.category === 'kampanya' && !job.data.emailTo) return
  // The in-app copy an admin user receives for an operation event stays in-app:
  // the e-mail leg belongs to the ops row alone, so the number of admin users
  // never changes how many e-mails go out.
  if (!isOps && policy?.role === 'admin') return
  // A policy targets one audience. Copies of the same event sent to another
  // role (e.g. the admin in-app copy of a customer return) are in-app only unless
  // the producer explicitly asked for an e-mail address.
  if (user && policy && !job.data.emailTo && user.role !== policy.role) return
  // Stage-gated types (return_status_changed) only e-mail the listed stages.
  if (policy && !isEmailStage(type, data)) return
  const emailTo = (job.data.emailTo ?? user?.email ?? '').trim().toLowerCase()
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
      userId: deliveryUserId,
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
    // Being addressed to the ops mailbox is not on its own a licence to skip the
    // role check: only the declared operation types may take this path.
    if (isOps) {
      if (!ADMIN_OPERATION_TYPES.has(type) || config.role !== 'admin')
        throw new Error('EMAIL_OPS_TYPE_NOT_ALLOWED')
    } else if (user && user.role !== config.role) {
      throw new Error('EMAIL_RECIPIENT_ROLE_MISMATCH')
    }
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
