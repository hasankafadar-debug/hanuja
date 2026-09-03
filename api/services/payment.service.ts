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
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition } from '../domain/order-state-machine'
import { addBusinessDays } from '../domain/business-days'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { createOrderDocumentService } from './order-document.service'
import { postPaymentConfirmedSellerAccruals } from './seller-payment-accrual.service'
import { createQuantityRefundService } from './quantity-refund.service'
import { formatMoney } from '@hanuja/security/money'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'

/** Fire payment-confirmed notifications to customer + seller (fire-and-forget). */
export async function firePaymentConfirmedNotifications(prisma: PrismaClient, orderId: string) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        publicNumber: true,
        totalAmount: true,
        customerId: true,
        customer: { select: { email: true, name: true } },
        payments: {
          where: { status: 'confirmed' },
          orderBy: { confirmedAt: 'desc' },
          take: 1,
          select: { method: true },
        },
        lines: {
          select: {
            sellerId: true,
            productName: true,
            variantName: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
            seller: {
              select: {
                displayName: true,
                user: { select: { id: true, email: true } },
              },
            },
          },
        },
      },
    })
    if (!order) return
    const orderNumber = formatOrderNumber(order.publicNumber, order.id)
    const customerItems = order.lines.map((line) => ({
      productName: line.productName,
      variantName: line.variantName,
      sellerId: line.sellerId,
      quantity: line.quantity,
      unitPrice: formatMoney(line.unitPrice.toNumber()),
      lineTotal: formatMoney(line.totalPrice.toNumber()),
    }))
    await enqueueNotification({
      eventKey: `order:${order.id}:payment-confirmed:customer`,
      userId: order.customerId,
      emailTo: order.customer.email,
      type: 'order_payment_confirmed',
      title: 'Ödemeniz Onaylandı',
      body: 'Siparişiniz ödeme onayı aldı ve satıcıya iletildi.',
      data: {
        orderId,
        orderNumber,
        customerName: order.customer.name ?? 'Değerli Müşterimiz',
        paymentMethod: order.payments[0]?.method ?? 'card',
        totalAmount: formatMoney(order.totalAmount.toNumber()),
        orderUrl: `${getWebBaseUrl()}/siparis/${order.id}`,
        items: customerItems,
      },
    })

    const sellerIds = [...new Set(order.lines.map((line) => line.sellerId))]
    for (const sellerId of sellerIds) {
      const sellerLines = order.lines.filter((line) => line.sellerId === sellerId)
      const seller = sellerLines[0]?.seller
      if (!seller) continue
      await enqueueNotification({
        eventKey: `order:${order.id}:payment-confirmed:seller:${sellerId}`,
        userId: seller.user.id,
        emailTo: seller.user.email,
        type: 'seller_order_received',
        title: 'Yeni Sipariş',
        body: 'Ödeme onaylı yeni bir sipariş aldınız.',
        data: {
          orderId,
          orderNumber,
          sellerId,
          sellerName: seller.displayName,
          totalAmount: formatMoney(
            sellerLines
              .reduce((sum, line) => sum.add(line.totalPrice), new Decimal(0))
              .toNumber(),
          ),
          panelUrl: `${getSellerPanelUrl()}/siparisler/${order.id}`,
          items: sellerLines.map((line) => ({
            productName: line.productName,
            variantName: line.variantName,
            sellerId,
            quantity: line.quantity,
            unitPrice: formatMoney(line.unitPrice.toNumber()),
            lineTotal: formatMoney(line.totalPrice.toNumber()),
          })),
        },
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
  const quantityRefunds = createQuantityRefundService({ prisma })
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

        return updated
      }).then((result) => {
        // Fire-and-forget: do not block payment response
        void firePaymentConfirmedNotifications(prisma, params.orderId)
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

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: params.orderId },
        include: { lines: { where: { sellerId: params.sellerId } } },
      })
      const grossProductAmount = order.lines.reduce(
        (sum, line) => sum.add(line.totalPrice),
        new Decimal(0),
      )
      const couponAdjustmentAmount = order.lines.reduce(
        (sum, line) => sum.add(line.couponDiscountAmount),
        new Decimal(0),
      )
      const sellerAdjustmentAmount = order.lines.reduce(
        (sum, line) => sum.add(line.netPayoutAmount),
        new Decimal(0),
      )
      const commissionAdjustmentAmount = order.lines.reduce(
        (sum, line) => sum.add(line.commissionAmount),
        new Decimal(0),
      )
      return quantityRefunds.queue({
        orderId: params.orderId,
        sellerId: params.sellerId,
        sourceType: 'cancellation',
        sourceId: `legacy-order:${params.orderId}:${params.sellerId}`,
        customerAmount: params.refundAmount,
        grossProductAmount,
        couponAdjustmentAmount,
        sellerAdjustmentAmount,
        commissionAdjustmentAmount,
        platformFundedAmount: Decimal.max(
          new Decimal(0),
          params.refundAmount
            .sub(sellerAdjustmentAmount)
            .sub(commissionAdjustmentAmount),
        ),
      })
    },

    getPendingEftList() {
      return payments.listPendingEft()
    },
  }
}

export type PaymentService = ReturnType<typeof createPaymentService>
