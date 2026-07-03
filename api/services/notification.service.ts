/**
 * Notification service - creates and manages in-app notifications.
 *
 * All notification dispatch is async via BullMQ (notification-dispatch job).
 * This service handles listing and marking-as-read.
 */
import type { NotificationType as PrismaNotificationType, PrismaClient } from '@prisma/client'
import { enqueueNotification } from '../jobs/notification-dispatch.job'

export type NotificationType = PrismaNotificationType

export interface NotificationPayload {
  userId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
  emailTo?: string
  replyTo?: string
}

export interface NotificationServiceDeps {
  prisma: PrismaClient
}

export function createNotificationService({ prisma }: NotificationServiceDeps) {
  /**
   * Enqueue a notification for async delivery.
   * Idempotent: duplicate messages are deduplicated by the job processor via the DB record.
   */
  async function send(payload: NotificationPayload): Promise<void> {
    await enqueueNotification({
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      ...(payload.data ? { data: payload.data } : {}),
      ...(payload.emailTo ? { emailTo: payload.emailTo } : {}),
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    })
  }

  async function listForUser(
    userId: string,
    opts: { unreadOnly?: boolean; limit?: number; skip?: number } = {},
  ) {
    const { unreadOnly = false, limit = 20, skip = 0 } = opts
    return prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { isRead: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    })
  }

  async function countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    })
  }

  async function markRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, userId },
    })
    if (!notification) return null

    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    })
  }

  async function markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    return result.count
  }

  async function notifyOrderPaymentConfirmed(userId: string, orderId: string) {
    return send({
      userId,
      type: 'order_payment_confirmed',
      title: 'Ödemeniz Onaylandı',
      body: 'Siparişiniz ödeme onayı aldı ve satıcıya iletildi.',
      data: { orderId },
    })
  }

  async function notifyOrderShipped(userId: string, orderId: string, trackingNumber?: string) {
    return send({
      userId,
      type: 'order_shipped',
      title: 'Siparişiniz Kargoya Verildi',
      body: trackingNumber
        ? `Takip numaranız: ${trackingNumber}`
        : 'Siparişiniz kargoya verildi.',
      data: { orderId, trackingNumber },
    })
  }

  async function notifyOrderDeliveryConfirmed(userId: string, orderId: string) {
    return send({
      userId,
      type: 'order_delivery_confirmed',
      title: 'Teslimat Onaylandı',
      body: 'Siparişinizin teslim alındığı onaylandı.',
      data: { orderId },
    })
  }

  async function notifySellerOrderReceived(sellerUserId: string, orderId: string) {
    return send({
      userId: sellerUserId,
      type: 'seller_order_received',
      title: 'Yeni Sipariş',
      body: 'Ödeme onaylı yeni bir sipariş aldınız.',
      data: { orderId },
    })
  }

  async function notifySellerPayoutReady(sellerUserId: string, amount: string) {
    return send({
      userId: sellerUserId,
      type: 'seller_payout_ready',
      title: 'Hakediş Hazır',
      body: `${amount} tutarındaki hakediş ödeme için hazır.`,
      data: { amount },
    })
  }

  async function notifySellerPenaltyApplied(
    sellerUserId: string,
    orderId: string,
    amount: string,
  ) {
    return send({
      userId: sellerUserId,
      type: 'seller_penalty_applied',
      title: 'Ceza Uygulandı',
      body: `${amount} tutarında ceza hesabınıza yansıtıldı.`,
      data: { orderId, amount },
    })
  }

  async function notifySellerFulfillmentWarning(
    sellerUserId: string,
    orderId: string,
    orderNumber: string,
    daysRemaining: number,
  ) {
    return send({
      userId: sellerUserId,
      type: 'fulfillment_warning_5days',
      title: 'Sevk suresi yaklasiyor',
      body: `${orderNumber} numarali siparis icin ${daysRemaining} gun kaldi.`,
      data: { orderId, orderNumber, daysRemaining },
    })
  }

  async function notifySellerSupportReply(userId: string, ticketId: string, subject: string) {
    return send({
      userId,
      type: 'seller_support_reply',
      title: 'Destek talebiniz yanıtlandı',
      body: `"${subject}" başlıklı destek talebinize yanıt verildi.`,
      data: { ticketId },
    })
  }

  async function notifyAdminSupportNewTicket(
    userId: string,
    ticketId: string,
    sellerName: string,
    subject: string,
  ) {
    return send({
      userId,
      type: 'admin_support_new_ticket',
      title: 'Yeni destek talebi',
      body: `${sellerName} mağazası "${subject}" başlıklı yeni bir destek talebi açtı.`,
      data: { ticketId },
    })
  }

  async function notifyAdminsCustomerSupportNew(
    ticketId: string,
    orderPublicNumber: number,
    subject: string,
  ) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    })
    await Promise.allSettled(
      admins.map((admin) =>
        send({
          userId: admin.id,
          type: 'admin_customer_support_new',
          title: 'Yeni müşteri destek talebi',
          body: `Sipariş #${orderPublicNumber}: ${subject}`,
          data: { ticketId },
        }),
      ),
    )
  }

  async function notifyAdminsCustomerSupportReply(
    ticketId: string,
    orderPublicNumber: number,
  ) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    })
    await Promise.allSettled(
      admins.map((admin) =>
        send({
          userId: admin.id,
          type: 'admin_customer_support_reply',
          title: 'Müşteri destek talebi yanıtlandı',
          body: `Sipariş #${orderPublicNumber} için yeni müşteri mesajı.`,
          data: { ticketId },
        }),
      ),
    )
  }

  async function notifyCustomerSupportReply(
    customerId: string,
    ticketId: string,
    subject: string,
  ) {
    return send({
      userId: customerId,
      type: 'customer_support_reply',
      title: 'Destek talebinize yanıt verildi',
      body: subject,
      data: { ticketId },
    })
  }

  async function notifyCustomerSupportResolved(
    customerId: string,
    ticketId: string,
  ) {
    return send({
      userId: customerId,
      type: 'customer_support_resolved_notify',
      title: 'Destek talebiniz çözümlendi',
      body: 'Destek talebiniz kapatıldı.',
      data: { ticketId },
    })
  }

  return {
    send,
    listForUser,
    countUnread,
    markRead,
    markAllRead,
    notifyOrderPaymentConfirmed,
    notifyOrderShipped,
    notifyOrderDeliveryConfirmed,
    notifySellerOrderReceived,
    notifySellerPayoutReady,
    notifySellerPenaltyApplied,
    notifySellerFulfillmentWarning,
    notifySellerSupportReply,
    notifyAdminSupportNewTicket,
    notifyAdminsCustomerSupportNew,
    notifyAdminsCustomerSupportReply,
    notifyCustomerSupportReply,
    notifyCustomerSupportResolved,
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>
