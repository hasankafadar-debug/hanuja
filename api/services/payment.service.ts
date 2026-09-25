/**
 * Payment Service — handles payment confirmation, EFT approval, and webhook events.
 *
 * Security-critical: payment confirmation must come from verified backend source.
 * Do NOT trust frontend "payment successful" state.
 *
 * See: docs/05-security/payment-security.md
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ConflictError } from '../lib/errors'
import { createPaymentRepository } from '../repositories/payment.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition } from '../domain/order-state-machine'
import { addBusinessDays } from '../domain/business-days'
import { recordNotification } from './notification-outbox.service'
import {
  customerDisplayName,
  customerOrderEmailData,
  customerOrderLines,
  customerOrderUrl,
  loadOrderEmailSnapshot,
  sellerOrderEmailData,
} from './order-email-payload'
import { createOrderDocumentService } from './order-document.service'
import { postPaymentConfirmedSellerAccruals } from './seller-payment-accrual.service'
import { createRefundService } from './refund.service'
import { releaseRemainingOrderLines } from './order-line-release'
import { roundMoney } from '@hanuja/security/money'
import { resolveEftAdminDiscount } from '../domain/eft-admin-discount'
import { formatOrderNumber } from '../lib/order-number'

type PaymentNotificationClient = Pick<Prisma.TransactionClient, 'order' | 'notificationOutbox'>

/**
 * Payment-confirmed notifications for the customer and every seller with lines
 * on the order. Runs inside the confirming transaction so the outbox rows commit
 * (or roll back) together with the payment state.
 *
 * Card: the customer receives the single "Siparişiniz Alındı" e-mail here (no
 * e-mail was sent at checkout because the card could still fail). EFT: the
 * customer already received "Siparişiniz Alındı — Ödeme Bekleniyor" at checkout
 * and now gets "Ödemeniz Onaylandı".
 */
export async function firePaymentConfirmedNotifications(
  client: PaymentNotificationClient,
  orderId: string,
) {
  const order = await loadOrderEmailSnapshot(client, orderId)
  if (!order) return
  const paymentMethod = order.payments[0]?.method === 'eft' ? 'eft' : 'card'
  const orderNumber = formatOrderNumber(order.publicNumber, order.id)
  const customerData = customerOrderEmailData(order, {
    paymentMethod,
    paymentStatus: 'confirmed',
  })

  await recordNotification(client, {
    eventKey: `order:${order.id}:payment-confirmed:customer`,
    userId: order.customerId,
    emailTo: order.customer.email,
    type: paymentMethod === 'card' ? 'order_placed' : 'order_payment_confirmed',
    title: paymentMethod === 'card' ? `Siparişiniz Alındı - #${orderNumber}` : 'Ödemeniz Onaylandı',
    body:
      paymentMethod === 'card'
        ? 'Ödemeniz alındı ve siparişiniz satıcıya iletildi.'
        : 'Siparişiniz ödeme onayı aldı ve satıcıya iletildi.',
    data: customerData,
  })

  for (const seller of sellerOrderEmailData(order)) {
    await recordNotification(client, {
      eventKey: `order:${order.id}:payment-confirmed:seller:${seller.sellerId}`,
      userId: seller.sellerUserId,
      emailTo: seller.sellerEmail,
      type: 'seller_order_received',
      title: 'Yeni Sipariş',
      body: 'Ödeme onaylı yeni bir sipariş aldınız.',
      data: seller.data,
    })
  }
}

/** EFT rejection cancels the order before any money was collected; the customer is told why. */
async function recordEftRejectedNotification(
  client: PaymentNotificationClient,
  orderId: string,
  reason: string,
) {
  const order = await loadOrderEmailSnapshot(client, orderId)
  if (!order) return
  await recordNotification(client, {
    eventKey: `order:${order.id}:cancelled:payment_failure`,
    userId: order.customerId,
    emailTo: order.customer.email,
    type: 'order_cancelled',
    title: 'Siparişiniz iptal edildi',
    body: 'Havale/EFT ödemesi doğrulanamadığı için siparişiniz iptal edildi.',
    data: {
      orderId: order.id,
      orderNumber: formatOrderNumber(order.publicNumber, order.id),
      customerName: customerDisplayName(order),
      actorRole: 'payment_failure',
      partial: false,
      cancellationReason: reason,
      paymentMethod: 'eft',
      orderUrl: customerOrderUrl(order.id),
      items: customerOrderLines(order),
    },
  })
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
  const legacyRefunds = createRefundService({ prisma })
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
     *
     * Fail-closed doğrulamalar (transaction öncesi, PaymentEvent kanıtı kalıcı olsun diye):
     *   1. Tutar bağlama — provider'ın bildirdiği paidPrice sipariş toplamına eşit olmalı.
     *   2. providerRef tekrar kullanımı — aynı Iyzico paymentId başka siparişi onaylayamaz.
     */
    async confirmCardPayment(params: {
      orderId: string
      providerRef: string
      amount: import('@prisma/client/runtime/client').Decimal
      itemTransactions?: Array<{
        itemId: string
        paymentTransactionId: string
        transactionStatus?: number
        price?: string
        paidPrice?: string
      }>
    }) {
      const payment = await payments.findByOrderId(params.orderId)
      if (!payment) throw new NotFoundError('Payment', params.orderId)

      // Idempotency guard — already confirmed
      if (payment.status === 'confirmed') return payment

      if (payment.status !== 'pending') {
        throw new ConflictError(`Ödeme zaten işlendi: ${payment.status}`)
      }

      const orderForBinding = await prisma.order.findUnique({
        where: { id: params.orderId },
        select: { totalAmount: true },
      })
      if (!orderForBinding) throw new NotFoundError('Order', params.orderId)

      if (!params.amount.eq(orderForBinding.totalAmount)) {
        await payments.appendEvent({
          paymentId: payment.id,
          eventType: 'amount_mismatch_rejected',
          providerPayload: {
            expected: orderForBinding.totalAmount.toFixed(2),
            received: params.amount.toFixed(2),
            providerRef: params.providerRef,
          },
        })
        throw new ConflictError('Ödeme tutarı sipariş toplamı ile uyuşmuyor')
      }

      const existingByRef = await payments.findByProviderRef(params.providerRef)
      if (existingByRef && existingByRef.orderId !== params.orderId) {
        await payments.appendEvent({
          paymentId: payment.id,
          eventType: 'providerRef_reuse_rejected',
          providerPayload: {
            providerRef: params.providerRef,
            conflictingPaymentId: existingByRef.id,
          },
        })
        throw new ConflictError('Ödeme referansı başka bir siparişe ait')
      }

      const providerItems = await prisma.paymentProviderItem.findMany({
        where: { paymentId: payment.id },
        orderBy: { providerItemId: 'asc' },
      })
      const providerTransactions = params.itemTransactions ?? []
      if (providerItems.length > 0) {
        const byItemId = new Map(
          providerTransactions.map((item) => [item.itemId, item]),
        )
        if (
          byItemId.size !== providerTransactions.length ||
          providerItems.some((item) => !byItemId.has(item.providerItemId)) ||
          providerTransactions.some(
            (item) => !providerItems.some((expected) => expected.providerItemId === item.itemId),
          )
        ) {
          await payments.appendEvent({
            paymentId: payment.id,
            eventType: 'provider_item_mapping_rejected',
            providerPayload: {
              expectedItemIds: providerItems.map((item) => item.providerItemId),
              receivedItemIds: providerTransactions.map((item) => item.itemId),
              providerRef: params.providerRef,
            },
          })
          throw new ConflictError('Ödeme kalemleri sağlayıcı yanıtıyla uyuşmuyor')
        }
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

        if (providerItems.length > 0) {
          for (const item of providerItems) {
            const providerTransaction = providerTransactions.find(
              (candidate) => candidate.itemId === item.providerItemId,
            )!
            await tx.paymentProviderItem.update({
              where: { id: item.id },
              data: {
                providerTransactionId: providerTransaction.paymentTransactionId,
                providerData: providerTransaction as never,
              },
            })
          }
        } else {
          await tx.paymentEvent.create({
            data: {
              paymentId: payment.id,
              eventType: 'provider_item_mapping_missing',
              payload: {
                providerRef: params.providerRef,
                note: 'Eski kart ödemesi; otomatik kalem iadesi için manuel müdahale gerekir',
              },
            },
          })
        }

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

        await postPaymentConfirmedSellerAccruals({
          prisma,
          tx,
          orderId: params.orderId,
          effectiveAt: confirmedAt,
          actorId: 'system',
        })

        await firePaymentConfirmedNotifications(tx, params.orderId)

        return updated
      }).then((result) => {
        // Fire-and-forget: do not block payment response
        void fireInvoiceAliasGeneration(prisma, params.orderId)
        return result
      }).catch((error: unknown) => {
        // providerPaymentId @unique yarış penceresi — eşzamanlı çift onayda ikincisi P2002 alır
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          throw new ConflictError('Ödeme referansı başka bir siparişe ait')
        }
        throw error
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

      if (
        params.discountAmount !== undefined &&
        (!Number.isInteger(params.discountAmount) || params.discountAmount < 0)
      ) {
        throw new ConflictError('Geçersiz indirim tutarı')
      }
      // 0 (or omitted) means no discount.
      const discountDecimal = params.discountAmount
        ? new Decimal(params.discountAmount).div(100)
        : null

      return prisma.$transaction(async (tx) => {
        const confirmedAt = new Date()
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          include: {
            lines: {
              select: {
                id: true,
                sellerId: true,
                totalPrice: true,
                customerPaidProductAmount: true,
              },
              orderBy: { id: 'asc' },
            },
          },
        })
        if (!order) throw new NotFoundError('Order', params.orderId)
        // A cancelled (or otherwise moved-on) order must never be reopened by a
        // late approval: it would credit the seller and oversell released stock.
        if (order.status !== 'bank_transfer_waiting') {
          throw new ConflictError(
            `Sipariş havale onayı bekleyen durumda değil: ${order.status}`,
          )
        }
        assertTransition(order.status, 'bank_transfer_confirmed')

        // Admin discount is Hanuja-absorbed (like the EFT channel discount): it
        // lowers only what the customer pays for products — never shipping and
        // never a seller-side snapshot. See api/domain/eft-admin-discount.ts.
        const discount = discountDecimal
          ? resolveEftAdminDiscount({
              lines: order.lines,
              discount: discountDecimal,
              orderTotalAmount: order.totalAmount,
              shippingAmount: order.shippingAmount,
            })
          : null
        if (discount?.status === 'exceeds_paid_product_total') {
          throw new ConflictError('İndirim tutarı ürün tutarını aşamaz')
        }
        const previousPaymentAmount = payment.amount
        const collectedAmount = discountDecimal
          ? roundMoney(order.totalAmount.sub(discountDecimal))
          : null

        // Compare-and-swap: a concurrent customer cancellation closes the same
        // pending payment, so exactly one of the two succeeds.
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: {
            status: 'confirmed',
            confirmedAt,
            eftConfirmedBy: params.adminActorId,
            ...(discountDecimal && collectedAmount
              ? {
                  amount: collectedAmount,
                  eftDiscountAmount: discountDecimal,
                  eftDiscountReason: params.discountReason ?? null,
                }
              : {}),
          },
        })
        if (claimed.count !== 1) {
          throw new ConflictError('Ödeme durumu değişti; sayfayı yenileyin')
        }
        const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } })

        if (discountDecimal && collectedAmount && discount?.status === 'ok') {
          await (tx as PrismaClient).order.update({
            where: { id: params.orderId },
            data: {
              discountAmount: { increment: discountDecimal },
              totalAmount: collectedAmount,
            },
          })
          // Per-line customer-paid snapshots and provider refund caps exist only
          // on quantity-lifecycle orders. Legacy (v1) orders never carried them
          // and their refunds are capped by Payment.amount alone, so they are
          // left untouched.
          if (order.quantityLifecycleVersion === 2) {
            for (const line of discount.lines) {
              await (tx as PrismaClient).orderLine.update({
                where: { id: line.orderLineId },
                data: { customerPaidProductAmount: line.newPaidAmount },
              })
              await (tx as PrismaClient).paymentProviderItem.updateMany({
                where: { paymentId: payment.id, orderLineId: line.orderLineId, kind: 'product' },
                data: { amount: line.newPaidAmount },
              })
            }
          }
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
            // Sellers read this timeline: admin evidence and the discount stay
            // in the audit log only.
            reason: 'Havale onaylandı',
          },
        })
        await (tx as PrismaClient).cartItem.deleteMany({
          where: { cart: { userId: order.customerId } },
        })

        await postPaymentConfirmedSellerAccruals({
          prisma,
          tx,
          orderId: params.orderId,
          effectiveAt: confirmedAt,
          actorId: params.adminActorId,
        })

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'payment_approved',
          targetType: 'payment',
          targetId: payment.id,
          previousData: { status: payment.status, amount: previousPaymentAmount.toFixed(2) },
          newData: {
            status: 'confirmed',
            amount: updated.amount.toFixed(2),
            ...(discountDecimal
              ? {
                  eftDiscountAmount: discountDecimal.toFixed(2),
                  eftDiscountReason: params.discountReason,
                  ...(discount?.status === 'ok' && order.quantityLifecycleVersion === 2
                    ? {
                        lineDiscountShares: discount.lines.map((line) => ({
                          orderLineId: line.orderLineId,
                          discountShare: line.discountShare.toFixed(2),
                          customerPaidProductAmount: line.newPaidAmount.toFixed(2),
                        })),
                      }
                    : {}),
                }
              : {}),
          },
          ...(params.evidenceNote !== undefined ? { reason: params.evidenceNote } : {}),
        })

        await firePaymentConfirmedNotifications(tx, params.orderId)

        return updated
      }).then((result) => {
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
      if (payment.method !== 'eft') {
        throw new ConflictError('Bu ödeme havale/EFT değil')
      }
      if (payment.status !== 'pending') {
        throw new ConflictError(`Ödeme durumu reddetmeye uygun değil: ${payment.status}`)
      }

      return prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          select: { status: true },
        })
        if (!order) throw new NotFoundError('Order', params.orderId)
        // An order the customer already cancelled keeps its own status and is
        // not mailed a second cancellation.
        if (order.status !== 'bank_transfer_waiting') {
          throw new ConflictError(
            `Sipariş havale onayı bekleyen durumda değil: ${order.status}`,
          )
        }
        assertTransition(order.status, 'cancelled_due_to_payment_failure')

        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { status: 'failed' },
        })
        if (claimed.count !== 1) {
          throw new ConflictError('Ödeme durumu değişti; sayfayı yenileyin')
        }
        const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } })

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

        // The e-mail lists the still-active lines, so it is recorded first. The
        // reserved stock then returns to the catalog; nothing was collected, so
        // no refund record or seller ledger movement is written.
        await recordEftRejectedNotification(tx, params.orderId, params.reason)
        await releaseRemainingOrderLines(tx, params.orderId)

        return updated
      })
    },

    /**
     * Refund a confirmed payment — called after return/dispute resolved for customer.
     *
     * Legacy tam sipariş akışını da ortak, kalem-güvenli iade kuyruğuna taşır.
     * Kalem işlem ID'si bulunmayan eski kart ödemeleri otomatik çağrı yapmaz;
     * manuel müdahale durumunda kalır.
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

      return legacyRefunds.queueLegacyRefund({
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: 'cancellation',
        sourceId: `legacy-order:${params.orderId}:${params.sellerId}`,
        requestedCustomerAmount: params.refundAmount,
      })
    },

    getPendingEftList() {
      return payments.listPendingEft()
    },
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
