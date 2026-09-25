/**
 * Order Service - order lifecycle transitions, seller acceptance/rejection.
 * Business logic lives here, not in route handlers.
 */
import type { OrderCancellationReason, OrderStatus, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ConflictError } from '../lib/errors'
import { createOrderRepository } from '../repositories/order.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition, isPostShipmentStatus } from '../domain/order-state-machine'
import { createPenaltyService } from './penalty.service'
import { createPaymentService } from './payment.service'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { createQuantityCancellationService } from './quantity-cancellation.service'
import { createSellerApprovalQueryService } from './seller-approval-query.service'
import { recordWholeOrderCancellationNotifications } from './order-email-payload'
import { releaseRemainingOrderLines } from './order-line-release'

interface OrderServiceDeps {
  prisma: PrismaClient
}

export function createOrderService({ prisma }: OrderServiceDeps) {
  const orders = createOrderRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const penalties = createPenaltyService({ prisma })
  const payments = createPaymentService({ prisma })
  const quantityCancellations = createQuantityCancellationService({ prisma })

  function withQuantityAvailability<T extends { quantityLifecycleVersion: number; lines: Array<{
    quantity: number
    cancelledQuantity: number
    shippedQuantity: number
    returnClaimedQuantity: number
    deliveryConfirmedAt: Date | null
  }> }>(order: T) {
    if (order.quantityLifecycleVersion !== 2) return order
    return {
      ...order,
      lines: order.lines.map((line) => ({
        ...line,
        activeQuantity: Math.max(0, line.quantity - line.cancelledQuantity),
        cancellableQuantity: Math.max(
          0,
          line.quantity - line.cancelledQuantity - line.shippedQuantity,
        ),
        returnableQuantity:
          line.deliveryConfirmedAt && isWithinReturnWindow(line.deliveryConfirmedAt)
            ? Math.max(0, line.shippedQuantity - line.returnClaimedQuantity)
            : 0,
      })),
    }
  }

  async function cancelOrder(params: {
    orderId: string
    actorId: string
    toStatus: Extract<OrderStatus, 'cancelled_by_admin' | 'cancelled_by_customer' | 'cancelled_due_to_20day_breach'>
    note: string
    cancellationReason: OrderCancellationReason
    refund?: {
      amount: Decimal
      sellerId: string
      reason: string
      adminActorId: string
    }
    auditReason?: string
  }) {
    const order = await orders.findById(params.orderId)
    if (!order) throw new NotFoundError('Order', params.orderId)

    assertTransition(order.status, params.toStatus)

    const orderPayments = await prisma.payment.findMany({
      where: { orderId: params.orderId },
      select: { id: true, status: true, confirmedAt: true },
    })
    const paymentCollected = orderPayments.some((payment) => payment.confirmedAt !== null)

    await prisma.$transaction(async (tx) => {
      if (!paymentCollected) {
        // Leaves the EFT approval queue; losing the race to an approval aborts.
        const pending = orderPayments.filter((payment) => payment.status === 'pending')
        if (pending.length > 0) {
          const closed = await tx.payment.updateMany({
            where: {
              id: { in: pending.map((payment) => payment.id) },
              status: 'pending',
              confirmedAt: null,
            },
            data: { status: 'cancelled' },
          })
          if (closed.count !== pending.length) {
            throw new ConflictError('Ödeme bu sırada onaylandı veya kapatıldı; sayfayı yenileyin')
          }
          for (const payment of pending) {
            await tx.paymentEvent.create({
              data: {
                paymentId: payment.id,
                eventType: 'cancelled_before_confirmation',
                payload: { actorId: params.actorId, toStatus: params.toStatus },
              },
            })
          }
        }
      }

      await (tx as PrismaClient).order.update({
        where: { id: params.orderId },
        data: {
          status: params.toStatus,
          cancelledAt: new Date(),
          cancellationReason: params.cancellationReason,
        },
      })

      await orders.appendStatusHistory(
        params.orderId,
        params.toStatus,
        params.actorId,
        params.note,
        tx as PrismaClient,
      )

      await auditLog.createEntry({
        actorId: params.actorId,
        actionType: 'order_cancelled',
        targetType: 'order',
        targetId: params.orderId,
        previousData: { status: order.status, cancellationReason: order.cancellationReason ?? null },
        newData: { status: params.toStatus, cancellationReason: params.cancellationReason },
        ...(params.auditReason ? { reason: params.auditReason } : {}),
      })

      await recordWholeOrderCancellationNotifications(tx, params.orderId, {
        actorRole:
          params.toStatus === 'cancelled_by_admin'
            ? 'admin'
            : params.toStatus === 'cancelled_by_customer'
              ? 'customer'
              : 'system',
        reason: params.auditReason ?? params.note,
        eventSuffix: params.toStatus,
      })

      // After the e-mail snapshot, which lists the still-active lines. An unpaid
      // order returns its reserved stock; there is no refund or ledger effect.
      if (!paymentCollected) await releaseRemainingOrderLines(tx, params.orderId)
    })

    if (params.refund) {
      await payments.refundPayment({
        orderId: params.orderId,
        refundAmount: params.refund.amount,
        reason: params.refund.reason,
        adminActorId: params.refund.adminActorId,
        sellerId: params.refund.sellerId,
        skipOrderStatusUpdate: true,
      })
    }

    return orders.findById(params.orderId)
  }

  return {
    /**
     * Seller accepts an order - moves from seller_queue_ready to seller_accepted.
     * Validates ownership: seller can only accept their own orders.
     */
    async sellerAccept(params: { orderId: string; sellerId: string }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        return prisma.$transaction(async (tx) => {
          const fulfillment = await tx.orderSellerFulfillment.findUnique({
            where: {
              orderId_sellerId: { orderId: params.orderId, sellerId: params.sellerId },
            },
          })
          if (!fulfillment || !['queue_ready', 'reviewing'].includes(fulfillment.status)) {
            throw new ConflictError('Bu satıcı gönderisi onaylanabilecek durumda değil')
          }

          const changed = await tx.orderSellerFulfillment.updateMany({
            where: { id: fulfillment.id, status: fulfillment.status },
            data: { status: 'accepted', acceptedAt: new Date() },
          })
          if (changed.count !== 1) throw new ConflictError('Gönderi durumu başka bir işlemle değişti')

          await tx.order.updateMany({
            where: { id: params.orderId, status: 'seller_queue_ready' },
            data: { status: 'seller_accepted' },
          })
          await orders.appendStatusHistory(
            params.orderId,
            'seller_accepted',
            params.sellerId,
            'Satıcı tarafından onaylandı',
            tx as PrismaClient,
          )
          return tx.orderSellerFulfillment.findUniqueOrThrow({ where: { id: fulfillment.id } })
        })
      }

      assertTransition(order.status, 'seller_accepted')

      return prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'seller_accepted', tx as PrismaClient)
        return orders.appendStatusHistory(
          params.orderId,
          'seller_accepted',
          params.sellerId,
          'Satıcı tarafından onaylandı',
          tx as PrismaClient,
        )
      })
    },

    /**
     * Seller rejects a paid order.
     * Rejection reason is mandatory and recorded.
     * Rejection penalty remains the fixed 20% policy.
     */
    async sellerReject(params: {
      orderId: string
      sellerId: string
      reason: string
    }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        const items = order.lines
          .map((line) => ({
            orderLineId: line.id,
            quantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
          }))
          .filter((item) => item.quantity > 0)
        if (items.length === 0) {
          throw new ConflictError('Reddedilebilecek aktif ürün adedi kalmadı')
        }

        const result = await quantityCancellations.create({
          orderId: params.orderId,
          customerId: order.customerId,
          actorId: params.sellerId,
          reason: `Satıcı reddi: ${params.reason}`,
          idempotencyKey: `seller-reject:${params.orderId}:${params.sellerId}`,
          fullCancellationStatus: 'cancelled_due_to_seller_rejection',
          items,
        })
        await prisma.orderSellerFulfillment.update({
          where: {
            orderId_sellerId: { orderId: params.orderId, sellerId: params.sellerId },
          },
          data: { status: 'cancelled' },
        })
        await penalties.applyForCancellation({
          orderId: params.orderId,
          sellerId: params.sellerId,
          reason: 'seller_rejected_paid_order',
        })
        return result
      }

      assertTransition(order.status, 'seller_rejected')

      const result = await prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'seller_rejected', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'seller_rejected',
          params.sellerId,
          `Satıcı reddi: ${params.reason}`,
          tx as PrismaClient,
        )

        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: {
            status: 'cancelled_due_to_seller_rejection',
            cancelledAt: new Date(),
            cancellationReason: 'seller_rejected',
          },
        })

        const history = await orders.appendStatusHistory(
          params.orderId,
          'cancelled_due_to_seller_rejection',
          params.sellerId,
          'İptal edildi. Ceza değerlendiriliyor.',
          tx as PrismaClient,
        )
        await recordWholeOrderCancellationNotifications(tx, params.orderId, {
          actorRole: 'seller',
          reason: params.reason,
          eventSuffix: 'cancelled_due_to_seller_rejection',
        })
        return history
      })

      await penalties.applyForCancellation({
        orderId: params.orderId,
        sellerId: params.sellerId,
        reason: 'seller_rejected_paid_order',
      })

      return result
    },

    /**
     * Customer cancels before shipment.
     * After shipment, cancellation is not allowed - use return flow.
     * reason: customer-facing reason label stored in status history for audit.
     */
    async customerCancel(params: { orderId: string; customerId: string; reason?: string }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        throw new ConflictError('Bu siparişte ürün ve adet seçerek iptal oluşturun')
      }

      if (isPostShipmentStatus(order.status)) {
        throw new ConflictError(
          'Kargo sonrası iptal yapılamaz. İade talebi oluşturun.',
        )
      }

      const noteDetail = params.reason ? `: ${params.reason}` : ''
      return cancelOrder({
        orderId: params.orderId,
        actorId: params.customerId,
        toStatus: 'cancelled_by_customer',
        note: `Müşteri tarafından iptal edildi${noteDetail}`,
        cancellationReason: 'customer_requested',
      })
    },

    /**
     * Admin cancels an order with reason - auditable.
     *
     * Quantity-lifecycle orders go through the quantity cancellation: stock is
     * released, a paid order gets its customer refund and seller accrual
     * reversal, an unpaid EFT order only closes its pending payment. After
     * dispatch the return flow applies instead.
     */
    async adminCancel(params: {
      orderId: string
      adminActorId: string
      reason: string
    }) {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        select: {
          customerId: true,
          quantityLifecycleVersion: true,
          lines: {
            select: { id: true, quantity: true, cancelledQuantity: true, shippedQuantity: true },
          },
          payments: { select: { confirmedAt: true } },
        },
      })
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        if (order.lines.some((line) => line.shippedQuantity > 0)) {
          throw new ConflictError('Kargoya verilmiş ürün var; bu siparişte iade akışı kullanılmalı')
        }
        const items = order.lines
          .map((line) => ({
            orderLineId: line.id,
            quantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
          }))
          .filter((item) => item.quantity > 0)
        if (items.length === 0) {
          throw new ConflictError('İptal edilebilecek aktif ürün adedi kalmadı')
        }
        await quantityCancellations.create({
          orderId: params.orderId,
          customerId: order.customerId,
          actorId: params.adminActorId,
          actorRole: 'admin',
          reason: `Admin iptali: ${params.reason}`,
          idempotencyKey: `admin-cancel:${params.orderId}`,
          fullCancellationStatus: 'cancelled_by_admin',
          audit: { actorId: params.adminActorId, reason: params.reason },
          items,
        })
        return orders.findById(params.orderId)
      }

      // Legacy orders have no line-level refund path; cancelling a paid one here
      // used to skip the customer refund entirely.
      if (order.payments.some((payment) => payment.confirmedAt !== null)) {
        throw new ConflictError(
          'Eski akıştaki ödenmiş sipariş panelden iptal edilemez; finans incelemesi gerekir',
        )
      }

      return cancelOrder({
        orderId: params.orderId,
        actorId: params.adminActorId,
        toStatus: 'cancelled_by_admin',
        note: `Admin iptali: ${params.reason}`,
        cancellationReason: 'admin_cancelled',
        auditReason: params.reason,
      })
    },

    /**
     * Daily late-shipment accrual reaches day 20: auto-cancel and refund the customer.
     */
    async autoCancelForFulfillmentBreach(params: {
      orderId: string
      sellerId: string
      asOf?: Date
    }) {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          lines: {
            where: { sellerId: params.sellerId },
            select: { sellerId: true },
          },
        },
      })
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.status === 'cancelled_due_to_20day_breach') return order

      const sellerId = order.lines[0]?.sellerId ?? params.sellerId

      return cancelOrder({
        orderId: params.orderId,
        actorId: 'system',
        toStatus: 'cancelled_due_to_20day_breach',
        note: '20. gecikme günü doldu. Sipariş otomatik iptal edildi ve iade başlatıldı.',
        cancellationReason: 'auto_canceled_20day_breach',
        refund: {
          amount: order.totalAmount,
          sellerId,
          reason: '20 günlük sevkiyat ihlali nedeniyle otomatik iptal',
          adminActorId: 'system',
        },
        auditReason: `Fulfillment breach auto-cancel at ${(params.asOf ?? new Date()).toISOString()}`,
      })
    },

    async getOrderForCustomer(orderId: string, customerId: string) {
      const order = await orders.findByIdForCustomer(orderId, customerId)
      return order ? withQuantityAvailability(order) : null
    },

    async getOrderForSeller(orderId: string, sellerId: string) {
      const order = await orders.findByIdForSeller(orderId, sellerId)
      return order ? withQuantityAvailability(order) : null
    },

    async getOrderForAdmin(orderId: string) {
      const order = await orders.findById(orderId)
      return order ? withQuantityAvailability(order) : null
    },

    listForCustomer(customerId: string, skip?: number, take?: number) {
      return orders.listByCustomer({
        customerId,
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    listForSellerQueue(params: {
      sellerId: string
      orderIds?: string[]
      status?: OrderStatus[]
      query?: string
      from?: Date
      to?: Date
      missingInvoice?: boolean
      skip?: number
      take?: number
    }) {
      return orders.listForSellerQueue({
        sellerId: params.sellerId,
        ...(params.orderIds !== undefined ? { orderIds: params.orderIds } : {}),
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.query !== undefined ? { query: params.query } : {}),
        ...(params.from !== undefined ? { from: params.from } : {}),
        ...(params.to !== undefined ? { to: params.to } : {}),
        ...(params.missingInvoice !== undefined ? { missingInvoice: params.missingInvoice } : {}),
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        ...(params.take !== undefined ? { take: params.take } : {}),
      })
    },

    countForSellerQueue(params: {
      sellerId: string
      orderIds?: string[]
      status?: OrderStatus[]
      query?: string
      from?: Date
      to?: Date
      missingInvoice?: boolean
    }) {
      return orders.countForSellerQueue(params)
    },

    async listForAdmin(params: Parameters<typeof orders.listForAdmin>[0] & {
      sellerApprovalOverdue?: boolean
    }) {
      const { sellerApprovalOverdue, ...filters } = params
      const overdue = sellerApprovalOverdue
        ? await createSellerApprovalQueryService({ prisma }).listOverdueForAdmin()
        : null
      const overdueById = new Map(overdue?.rows.map((row) => [row.orderId, row]))
      const result = await orders.listForAdmin({
        ...filters,
        ...(overdue ? { orderedOrderIds: overdue.rows.map((row) => row.orderId) } : {}),
      })
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          sellerApprovalOverdue: overdueById.get(row.id) ?? null,
        })),
      }
    },
  }
}

export type OrderService = ReturnType<typeof createOrderService>
