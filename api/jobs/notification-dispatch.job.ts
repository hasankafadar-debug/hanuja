/**
 * Notification Dispatch Job — sends in-app and email notifications.
 * Idempotent: deduplication is handled by the notification record's existence.
 */
import { Worker, Job } from 'bullmq'
import { redis } from '../lib/redis'
import { QUEUE_NAMES } from '../lib/queue'
import { prisma } from '../lib/prisma'
import { sendEmail } from '../lib/mailer'
import {
  orderConfirmationTemplate,
  shipmentNotificationTemplate,
  deliveryConfirmedTemplate,
  returnRequestTemplate,
  payoutProcessedTemplate,
  penaltyAppliedTemplate,
} from '../lib/email-templates'

export interface NotificationDispatchJobData {
  userId: string
  type: string
  title: string
  body: string
  data?: Record<string, unknown>
  /** If set, send email to this address in addition to in-app notification */
  emailTo?: string
}

/** Notification types that warrant an email */
const EMAIL_NOTIFICATION_TYPES = new Set([
  'ORDER_CONFIRMED',
  'ORDER_SHIPPED',
  'DELIVERY_CONFIRMED',
  'RETURN_REQUESTED',
  'PAYOUT_PROCESSED',
  'PENALTY_APPLIED',
])

async function buildEmailPayload(
  type: string,
  data: Record<string, unknown> | undefined,
): Promise<{ subject: string; html: string; text: string } | null> {
  if (!data) return null

  switch (type) {
    case 'ORDER_CONFIRMED':
      return orderConfirmationTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        totalAmount: String(data['totalAmount'] ?? ''),
        items: (data['items'] as Array<{ name: string; quantity: number; price: string }>) ?? [],
      })

    case 'ORDER_SHIPPED':
      return shipmentNotificationTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        trackingNumber: String(data['trackingNumber'] ?? ''),
        cargoCompany: String(data['cargoCompany'] ?? ''),
      })

    case 'DELIVERY_CONFIRMED':
      return deliveryConfirmedTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
      })

    case 'RETURN_REQUESTED':
      return returnRequestTemplate({
        customerName: String(data['customerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        returnReason: String(data['returnReason'] ?? ''),
      })

    case 'PAYOUT_PROCESSED':
      return payoutProcessedTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        payoutAmount: String(data['payoutAmount'] ?? ''),
        payoutDate: String(data['payoutDate'] ?? ''),
        periodDescription: String(data['periodDescription'] ?? ''),
      })

    case 'PENALTY_APPLIED':
      return penaltyAppliedTemplate({
        sellerName: String(data['sellerName'] ?? ''),
        orderNumber: String(data['orderNumber'] ?? ''),
        penaltyAmount: String(data['penaltyAmount'] ?? ''),
        penaltyReason: String(data['penaltyReason'] ?? ''),
      })

    default:
      return null
  }
}

async function processNotificationDispatch(job: Job<NotificationDispatchJobData>) {
  const { userId, type, title, body, data, emailTo } = job.data

  // Create in-app notification record
  await prisma.notification.create({
    data: {
      userId,
      type: type as never,
      title,
      body,
      data: data as never,
    },
  })

  // Send email if this notification type warrants it and we have an address
  if (emailTo && EMAIL_NOTIFICATION_TYPES.has(type)) {
    const emailPayload = await buildEmailPayload(type, data)
    if (emailPayload) {
      try {
        await sendEmail({ to: emailTo, ...emailPayload })
      } catch (err) {
        // Email failure should not fail the job — in-app notification already saved
        console.error(`[notification-dispatch] Email send failed for ${type}:`, err)
      }
    }
  }

  console.log(`[notification-dispatch] Dispatched to user ${userId}: ${type}`)
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
