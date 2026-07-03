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
import { addBusinessDays } from '../domain/business-days'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { createOrderDocumentService } from './order-document.service'
import { formatMoney } from '@hanuja/security/money'

/** Fire payment-confirmed notifications to customer + seller (fire-and-forget). */
export async function firePaymentConfirmedNotifications(prisma: PrismaClient, orderId: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        lines: {
          select: { seller: { select: { userId: true } } },
          take: 1,
        },
      },
    })
    if (!order) return
    const sellerUserId = order.lines[0]?.seller?.userId
    await enqueueNotification({
      userId: order.customerId,
      type: 'order_payment_confirmed',
      title: 'Ödemeniz Onaylandı',
      body: 'Siparişiniz ödeme onayı aldı ve satıcıya iletildi.',
      data: { orderId },
    })
    if (sellerUserId) {
      await enqueueNotification({
        userId: sellerUserId,
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

async function fireInvoiceAliasGeneration(prisma: PrismaClient, orderId: string) {
  try {
    await createOrderDocumentService({ prisma }).ensureInvoiceAliasesForOrder(orderId)
  } catch (err) {
    console.error('[payment] Invoice alias generation failed:', err)
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

  async function stampFulfillmentDueDates(tx: PrismaClient, orderId: string, sourceAt: Date) {
    const lines = await tx.orderLine.findMany({
      where: { orderId },
      select: { id: true, promisedFulfillmentDays: true },
    })

    for (const line of lines) {
      const promisedDays = line.promisedFulfillmentDays
      if (!promisedDays || promisedDays <= 0) continue

      await tx.orderLine.update({
        where: { id: line.id },
        data: {
          fulfillmentDueAt: addBusinessDays(sourceAt, promisedDays),
        },
      })
    }
  }

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
        const confirmedAt = new Date()
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          select: { id: true, status: true, customerId: true },
        })
        if (!order) throw new NotFoundError('Order', params.orderId)

        assertTransition(order.status, 'payment_confirmed')

        const updated = await payments.confirm(
          payment.id,
          { providerRef: params.providerRef },
          tx as PrismaClient,
        )

        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: {
            status: 'payment_confirmed',
            paymentConfirmedAt: confirmedAt,
          },
        })
        await (tx as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: params.orderId,
            toStatus: 'payment_confirmed',
            actorId: 'system',
            reason: `Kart ödemesi onaylandı. Ref: ${params.providerRef}`,
          },
        })

        // Move to seller queue
        assertTransition('payment_confirmed', 'seller_queue_ready')
        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: {
            status: 'seller_queue_ready',
            sellerQueueReadyAt: confirmedAt,
          },
        })
        await stampFulfillmentDueDates(tx as PrismaClient, params.orderId, confirmedAt)
        await (tx as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: params.orderId,
            toStatus: 'seller_queue_ready',
            actorId: 'system',
            reason: 'Satıcı kuyruğuna düştü',
          },
        })
        await (tx as PrismaClient).cartItem.deleteMany({
          where: { cart: { userId: order.customerId } },
        })

        return updated
      }).then((result) => {
        // Fire-and-forget: do not block payment response
        void firePaymentConfirmedNotifications(prisma, params.orderId)
        void fireInvoiceAliasGeneration(prisma, params.orderId)
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
      discountAmount?: number // TRY kuruş (cents) — opsiyonel admin indirimi
      discountReason?: string
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

      const discountDecimal = params.discountAmount
        ? new Decimal(params.discountAmount).div(100)
        : null

      return prisma.$transaction(async (tx) => {
        const confirmedAt = new Date()
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          include: { lines: { select: { sellerId: true } } },
        })
        if (!order) throw new NotFoundError('Order', params.orderId)

        // Geçerli indirim tutarı ürün toplamını aşamaz
        if (discountDecimal && discountDecimal.gt(order.totalAmount)) {
          throw new ConflictError('İndirim tutarı sipariş toplamını aşamaz')
        }

        const updatedPaymentData: Record<string, unknown> = {
          confirmedBy: params.adminActorId,
        }
        if (discountDecimal) {
          updatedPaymentData.eftDiscountAmount = discountDecimal
          updatedPaymentData.eftDiscountReason = params.discountReason ?? null
        }

        const updated = await payments.confirm(
          payment.id,
          updatedPaymentData,
          tx as PrismaClient,
        )

        // Siparişin toplam tutarını indirimi yansıtacak şekilde güncelle
        if (discountDecimal) {
          await (tx as PrismaClient).order.update({
            where: { id: params.orderId },
            data: {
              discountAmount: { increment: discountDecimal },
              totalAmount: { decrement: discountDecimal },
            },
          })
        }

        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: { status: 'bank_transfer_confirmed' },
        })
        await (tx as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: params.orderId,
            toStatus: 'bank_transfer_confirmed',
            actorId: params.adminActorId,
            reason: 'Havale/EFT dekontu onaylandı',
          },
        })

        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: {
            status: 'payment_confirmed',
            paymentConfirmedAt: confirmedAt,
          },
        })
        await (tx as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: params.orderId,
            toStatus: 'payment_confirmed',
            actorId: params.adminActorId,
            reason: 'Havale/EFT ödemesi onaylandı',
          },
        })

        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: {
            status: 'seller_queue_ready',
            sellerQueueReadyAt: confirmedAt,
          },
        })
        await stampFulfillmentDueDates(tx as PrismaClient, params.orderId, confirmedAt)
        await (tx as PrismaClient).orderStatusHistory.create({
          data: {
            orderId: params.orderId,
            toStatus: 'seller_queue_ready',
            actorId: params.adminActorId,
            reason: `Havale onaylandı. ${params.evidenceNote ?? ''}${discountDecimal ? ` İndirim: ${formatMoney(discountDecimal.toNumber())} (${params.discountReason ?? ''})` : ''}`.trim(),
          },
        })
        await (tx as PrismaClient).cartItem.deleteMany({
          where: { cart: { userId: order.customerId } },
        })

        // EFT indirim — platform-absorbe: satıcı payout'u etkilemez.
        // Bu kayıt yalnızca mutabakat/audit amaçlı; Payout.netAmount bu girdiden hesaplanmaz.
        // visibleToSeller: false — satıcı ekstresinde görünmez (docs/01-business/payout-policy.md §12).
        if (discountDecimal) {
          const sellerEntry = order.lines[0] as { sellerId?: string } | undefined
          const sellerId = sellerEntry?.sellerId
          if (sellerId) {
            await ledger.createEntry({
              sellerId,
              type: 'eft_discount',
              amount: discountDecimal.negated(),
              orderId: params.orderId,
              note: `Havale indirimi (platform-absorbe): ${params.discountReason ?? 'Admin onayı'}`,
              createdBy: params.adminActorId,
              visibleToSeller: false,
            })
          }
        }

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'payment_approved',
          targetType: 'payment',
          targetId: payment.id,
          previousData: { status: payment.status },
          newData: {
            status: 'confirmed',
            ...(discountDecimal ? { eftDiscountAmount: discountDecimal.toFixed(2), eftDiscountReason: params.discountReason } : {}),
          },
          ...(params.evidenceNote !== undefined ? { reason: params.evidenceNote } : {}),
        })

        return updated
      }).then((result) => {
        void firePaymentConfirmedNotifications(prisma, params.orderId)
        void fireInvoiceAliasGeneration(prisma, params.orderId)
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
      skipOrderStatusUpdate?: boolean
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

        if (params.skipOrderStatusUpdate) {
          await (tx as PrismaClient).order.update({
            where: { id: params.orderId },
            data: { refundCompletedAt: new Date() },
          })
        } else {
          await orders.updateStatus(params.orderId, 'refund_completed' as never, tx as PrismaClient)
          await orders.appendStatusHistory(
            params.orderId,
            'refund_completed' as never,
            params.adminActorId,
            `İade tamamlandı: ${params.refundAmount.toFixed(2)} TRY`,
            tx as PrismaClient,
          )
        }

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
