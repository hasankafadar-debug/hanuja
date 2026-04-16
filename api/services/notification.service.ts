/**
 * Notification service — creates and manages in-app notifications.
 *
 * All notification dispatch is async via BullMQ (notification-dispatch job).
 * This service handles listing and marking-as-read.
 */
import type { PrismaClient } from '@prisma/client'
import { enqueueNotification } from '../jobs/notification-dispatch.job'

export type NotificationType =
  | 'order_payment_confirmed'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_delivery_confirmed'
  | 'order_canceled'
  | 'order_return_approved'
  | 'order_return_rejected'
  | 'seller_order_received'
  | 'seller_payout_ready'
  | 'seller_payout_paid'
  | 'seller_penalty_applied'
  | 'seller_return_request'
  | 'admin_bank_transfer_pending'
  | 'admin_dispute_opened'

export interface NotificationPayload {
  userId: string
  type: NotificationType
  title: string
  body: string
  data?: Record<string, unknown>
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
    })
  }

  /**
   * List unread (or all) notifications for a user.
   */
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

  /**
   * Count unread notifications for a user (used for bell badge).
   */
  async function countUnread(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, isRead: false },
    })
  }

  /**
   * Mark a single notification as read.
   * Returns null if the notification doesn't belong to the user.
   */
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

  /**
   * Mark all notifications as read for a user.
   */
  async function markAllRead(userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    })
    return result.count
  }

  // ── Convenience senders for common marketplace events ──────────────────

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

  async function notifySellerOrderReceived(sellerId: string, orderId: string) {
    return send({
      userId: sellerId,
      type: 'seller_order_received',
      title: 'Yeni Sipariş',
      body: 'Ödeme onaylı yeni bir sipariş aldınız.',
      data: { orderId },
    })
  }

  async function notifySellerPayoutReady(sellerId: string, amount: string) {
    return send({
      userId: sellerId,
      type: 'seller_payout_ready',
      title: 'Hakediş Hazır',
      body: `${amount} tutarındaki hakediş ödeme için hazır.`,
      data: { amount },
    })
  }

  async function notifySellerPenaltyApplied(
    sellerId: string,
    orderId: string,
    amount: string,
  ) {
    return send({
      userId: sellerId,
      type: 'seller_penalty_applied',
      title: 'Ceza Uygulandı',
      body: `${amount} tutarında ceza hesabınıza yansıtıldı.`,
      data: { orderId, amount },
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
  }
}

export type NotificationService = ReturnType<typeof createNotificationService>
