/**
 * Payment Service — handles payment confirmation, EFT approval, and webhook events.
 *
 * Security-critical: payment confirmation must come from verified backend source.
 * Do NOT trust frontend "payment successful" state.
 *
 * See: docs/05-security/payment-security.md
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ConflictError } from '../lib/errors'
import { createPaymentRepository } from '../repositories/payment.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition } from '../domain/order-state-machine'
import { enqueueNotification } from '../jobs/notification-dispatch.job'

/** Fire payment-confirmed notifications to customer + seller (fire-and-forget). */
async function firePaymentConfirmedNotifications(prisma: PrismaClient, orderId: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true, lines: { select: { sellerId: true }, take: 1 } },
    })
    if (!order) return
    const sellerId = order.lines[0]?.sellerId
    await enqueueNotification({
      userId: order.customerId,
      type: 'order_payment_confirmed',
      title: 'Ödemeniz Onaylandı',
      body: 'Siparişiniz ödeme onayı aldı ve satıcıya iletildi.',
      data: { orderId },
    })
    if (sellerId) {
      await enqueueNotification({
        userId: sellerId,
        type: 'seller_order_received',
        title: 'Yeni Sipariş',
        body: 'Ödeme onaylı yeni bir sipariş aldınız.',
        data: { orderId },
      })
    }
  } catch (err) {
    console.error('[payment] Notification enqueue failed:', err)
  }
}

interface PaymentServiceDeps {
  prisma: PrismaClient
}

export function createPaymentService({ prisma }: PaymentServiceDeps) {
  const payments = createPaymentRepository(prisma)
  const orders = createOrderRepository(prisma)
  const ledger = createSellerLedgerRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Confirm a card payment (called after Iyzico webhook or callback verification).
     * Idempotent — safe to call twice with same providerRef.
     */
    async confirmCardPayment(params: {
      orderId: string
      providerRef: string
      amount: import('@prisma/client/runtime/client').Decimal
    }) {
      const payment = await payments.findByOrderId(params.orderId)
      if (!payment) throw new NotFoundError('Payment', params.orderId)

      // Idempotency guard — already confirmed
      if (payment.status === 'confirmed') return payment

      if (payment.status !== 'pending') {
        throw new ConflictError(`Ödeme zaten işlendi: ${payment.status}`)
      }

      return prisma.$transaction(async (tx) => {
        const order = await orders.findById(params.orderId)
        if (!order) throw new NotFoundError('Order', params.orderId)

        assertTransition(order.status, 'payment_confirmed')

        const updated = await payments.confirm(
          payment.id,
          { providerRef: params.providerRef },
          tx as PrismaClient,
        )

        await orders.updateStatus(params.orderId, 'payment_confirmed', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'payment_confirmed',
          'system',
          `Kart ödemesi onaylandı. Ref: ${params.providerRef}`,
          tx as PrismaClient,
        )

        // Move to seller queue
        assertTransition('payment_confirmed', 'seller_queue_ready')
        await orders.updateStatus(params.orderId, 'seller_queue_ready', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'seller_queue_ready',
          'system',
          'Satıcı kuyruğuna düştü',
          tx as PrismaClient,
        )

        return updated
      }).then((result) => {
        // Fire-and-forget: do not block payment response
        void firePaymentConfirmedNotifications(prisma, params.orderId)
        return result
      })
    },

    /**
     * Approve a pending EFT/havale payment — admin only.
     * Requires explicit admin actor ID for audit trail.
     */
    async approveEftPayment(params: {
      orderId: string
      adminActorId: string
      evidenceNote?: string
    }) {
      const payment = await payments.findByOrderId(params.orderId)
      if (!payment) throw new NotFoundError('Payment', params.orderId)

      if (payment.method !== 'eft') {
        throw new ConflictError('Bu ödeme havale/EFT değil')
      }
      if (payment.status === 'confirmed') return payment
      if (payment.status !== 'pending') {
        throw new ConflictError(`Ödeme durumu onaylamaya uygun değil: ${payment.status}`)
      }

      return prisma.$transaction(async (tx) => {
        const order = await orders.findById(params.orderId)
        if (!order) throw new NotFoundError('Order', params.orderId)

        const updated = await payments.confirm(
          payment.id,
          { confirmedBy: params.adminActorId },
          tx as PrismaClient,
        )

        await orders.updateStatus(params.orderId, 'bank_transfer_confirmed', tx as PrismaClient)
        await orders.updateStatus(params.orderId, 'payment_confirmed', tx as PrismaClient)
        await orders.updateStatus(params.orderId, 'seller_queue_ready', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'seller_queue_ready',
          params.adminActorId,
          `Havale onaylandı. ${params.evidenceNote ?? ''}`,
          tx as PrismaClient,
        )

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'payment_approved',
          targetType: 'payment',
          targetId: payment.id,
          previousData: { status: payment.status },
          newData: { status: 'confirmed' },
          ...(params.evidenceNote !== undefined ? { reason: params.evidenceNote } : {}),
        })

        return updated
      }).then((result) => {
        void firePaymentConfirmedNotifications(prisma, params.orderId)
        return result
      })
    },

    /**
     * Reject an EFT payment — admin only.
     */
    async rejectEftPayment(params: {
      orderId: string
      adminActorId: string
      reason: string
    }) {
      const payment = await payments.findByOrderId(params.orderId)
      if (!payment) throw new NotFoundError('Payment', params.orderId)

      return prisma.$transaction(async (tx) => {
        const updated = await payments.updateStatus(
          payment.id,
          'failed',
          tx as PrismaClient,
        )

        await orders.updateStatus(
          params.orderId,
          'cancelled_due_to_payment_failure',
          tx as PrismaClient,
        )
        await orders.appendStatusHistory(
          params.orderId,
          'cancelled_due_to_payment_failure',
          params.adminActorId,
          `Havale reddedildi: ${params.reason}`,
          tx as PrismaClient,
        )

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'payment_rejected',
          targetType: 'payment',
          targetId: payment.id,
          previousData: { status: payment.status },
          newData: { status: 'failed' },
          reason: params.reason,
        })

        return updated
      })
    },

    /**
     * Refund a confirmed payment — called after return/dispute resolved for customer.
     *
     * Database tarafını kaydeder + seller ledger'a debit yazar.
     * Gerçek Iyzico refund API çağrısı entegrasyon katmanında yapılır
     * (iyzico.refund(providerPaymentId, amount)).
     *
     * See: docs/05-security/payment-security.md
     */
    async refundPayment(params: {
      orderId: string
      refundAmount: Decimal
      reason: string
      adminActorId: string
      sellerId: string
    }) {
      const payment = await payments.findByOrderId(params.orderId)
      if (!payment) throw new NotFoundError('Payment', params.orderId)

      if (payment.status !== 'confirmed') {
        throw new ConflictError(`İade edilebilir onaylı ödeme yok: ${payment.status}`)
      }

      return prisma.$transaction(async (tx) => {
        const updated = await payments.recordRefund(
          payment.id,
          { refundAmount: params.refundAmount },
          tx as PrismaClient,
        )

        await payments.appendEvent({
          paymentId: payment.id,
          eventType: 'refund_recorded',
          note: `İade: ${params.refundAmount.toFixed(2)} TRY — ${params.reason}`,
        })

        // Seller ledger'a refund debit yaz (satıcıdan düşülür)
        await ledger.createEntry({
          sellerId: params.sellerId,
          type: 'refund',
          amount: params.refundAmount.negated(),
          orderId: params.orderId,
          note: `İade kesintisi: ${params.reason}`,
          createdBy: params.adminActorId,
        })

        await orders.updateStatus(params.orderId, 'refund_completed' as never, tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'refund_completed' as never,
          params.adminActorId,
          `İade tamamlandı: ${params.refundAmount.toFixed(2)} TRY`,
          tx as PrismaClient,
        )

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'manual_ledger_adjustment',
          targetType: 'payment',
          targetId: payment.id,
          previousData: { status: payment.status },
          newData: { status: 'refunded', refundAmount: params.refundAmount },
          reason: params.reason,
        })

        return updated
      })
    },

    getPendingEftList() {
      return payments.listPendingEft()
    },
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
