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

interface OrderServiceDeps {
  prisma: PrismaClient
}

export function createOrderService({ prisma }: OrderServiceDeps) {
  const orders = createOrderRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)
  const penalties = createPenaltyService({ prisma })
  const payments = createPaymentService({ prisma })

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

    await prisma.$transaction(async (tx) => {
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

      assertTransition(order.status, 'seller_accepted')

      return prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'seller_accepted', tx as PrismaClient)
        return orders.appendStatusHistory(
          params.orderId,
          'seller_accepted',
          params.sellerId,
          'SatÄ±cÄ± tarafÄ±ndan onaylandÄ±',
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

      assertTransition(order.status, 'seller_rejected')

      const result = await prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'seller_rejected', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'seller_rejected',
          params.sellerId,
          `SatÄ±cÄ± reddi: ${params.reason}`,
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

        return orders.appendStatusHistory(
          params.orderId,
          'cancelled_due_to_seller_rejection',
          params.sellerId,
          'Ä°ptal edildi. Ceza deÄŸerlendiriliyor.',
          tx as PrismaClient,
        )
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
     */
    async customerCancel(params: { orderId: string; customerId: string }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (isPostShipmentStatus(order.status)) {
        throw new ConflictError(
          'Kargo sonrasÄ± iptal yapÄ±lamaz. Ä°ade talebi oluÅŸturun.',
        )
      }

      return cancelOrder({
        orderId: params.orderId,
        actorId: params.customerId,
        toStatus: 'cancelled_by_customer',
        note: 'MÃ¼ÅŸteri tarafÄ±ndan iptal edildi',
        cancellationReason: 'customer_requested',
      })
    },

    /**
     * Admin cancels an order with reason - auditable.
     */
    async adminCancel(params: {
      orderId: string
      adminActorId: string
      reason: string
    }) {
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
        note: '20. gecikme gÃ¼nÃ¼ doldu. SipariÅŸ otomatik iptal edildi ve iade baÅŸlatÄ±ldÄ±.',
        cancellationReason: 'auto_canceled_20day_breach',
        refund: {
          amount: order.totalAmount,
          sellerId,
          reason: '20 gÃ¼nlÃ¼k sevkiyat ihlali nedeniyle otomatik iptal',
          adminActorId: 'system',
        },
        auditReason: `Fulfillment breach auto-cancel at ${(params.asOf ?? new Date()).toISOString()}`,
      })
    },

    getOrderForCustomer(orderId: string, customerId: string) {
      return orders.findByIdForCustomer(orderId, customerId)
    },

    getOrderForSeller(orderId: string, sellerId: string) {
      return orders.findByIdForSeller(orderId, sellerId)
    },

    getOrderForAdmin(orderId: string) {
      return orders.findById(orderId)
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
      status?: OrderStatus[]
      query?: string
      from?: Date
      to?: Date
      missingInvoice?: boolean
    }) {
      return orders.countForSellerQueue(params)
    },

    listForAdmin(params: Parameters<typeof orders.listForAdmin>[0]) {
      return orders.listForAdmin(params)
    },
  }
}

export type OrderService = ReturnType<typeof createOrderService>
