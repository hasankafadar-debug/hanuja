/**
 * Order Service — order lifecycle transitions, seller acceptance/rejection.
 * Business logic lives here, not in route handlers.
 */
import type { PrismaClient } from '@prisma/client'
import { NotFoundError, ForbiddenError, ConflictError } from '../lib/errors'
import { createOrderRepository } from '../repositories/order.repository'
import { createSellerRepository } from '../repositories/seller.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition, isPostShipmentStatus } from '../domain/order-state-machine'

interface OrderServiceDeps {
  prisma: PrismaClient
}

export function createOrderService({ prisma }: OrderServiceDeps) {
  const orders = createOrderRepository(prisma)
  const sellers = createSellerRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Seller accepts an order — moves from seller_queue_ready to seller_accepted.
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
          'Satıcı tarafından onaylandı',
          tx as PrismaClient,
        )
      })
    },

    /**
     * Seller rejects a paid order.
     * Penalty evaluation is handled by penalty.service — called from order lifecycle hook.
     * Rejection reason is mandatory and recorded.
     */
    async sellerReject(params: {
      orderId: string
      sellerId: string
      reason: string
    }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      assertTransition(order.status, 'seller_rejected')

      return prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'seller_rejected', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'seller_rejected',
          params.sellerId,
          `Satıcı reddi: ${params.reason}`,
          tx as PrismaClient,
        )
        // Transition to cancellation
        await orders.updateStatus(
          params.orderId,
          'cancelled_due_to_seller_rejection',
          tx as PrismaClient,
        )
        return orders.appendStatusHistory(
          params.orderId,
          'cancelled_due_to_seller_rejection',
          params.sellerId,
          `İptal edildi. Ceza değerlendiriliyor.`,
          tx as PrismaClient,
        )
      })
    },

    /**
     * Customer cancels before shipment.
     * After shipment, cancellation is not allowed — use return flow.
     */
    async customerCancel(params: { orderId: string; customerId: string }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (isPostShipmentStatus(order.status)) {
        throw new ConflictError(
          'Kargo sonrası iptal yapılamaz. İade talebi oluşturun.',
        )
      }

      assertTransition(order.status, 'cancelled_by_customer')

      return prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'cancelled_by_customer', tx as PrismaClient)
        return orders.appendStatusHistory(
          params.orderId,
          'cancelled_by_customer',
          params.customerId,
          'Müşteri tarafından iptal edildi',
          tx as PrismaClient,
        )
      })
    },

    /**
     * Admin cancels an order with reason — auditable.
     */
    async adminCancel(params: {
      orderId: string
      adminActorId: string
      reason: string
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      assertTransition(order.status, 'cancelled_by_admin')

      return prisma.$transaction(async (tx) => {
        await orders.updateStatus(params.orderId, 'cancelled_by_admin', tx as PrismaClient)
        await orders.appendStatusHistory(
          params.orderId,
          'cancelled_by_admin',
          params.adminActorId,
          `Admin iptali: ${params.reason}`,
          tx as PrismaClient,
        )

        await auditLog.createEntry({
          actorId: params.adminActorId,
          actionType: 'order_cancelled',
          targetType: 'order',
          targetId: params.orderId,
          previousData: { status: order.status },
          newData: { status: 'cancelled_by_admin' },
          reason: params.reason,
        })
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

    listForSellerQueue(sellerId: string, skip?: number, take?: number) {
      return orders.listForSellerQueue({
        sellerId,
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    listForAdmin(params: Parameters<typeof orders.listForAdmin>[0]) {
      return orders.listForAdmin(params)
    },
  }
}

export type OrderService = ReturnType<typeof createOrderService>
