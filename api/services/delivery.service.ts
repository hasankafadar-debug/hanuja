/**
 * Delivery Service — shipment entry, delivery confirmation logic.
 *
 * KEY INVARIANT: delivery_confirmed ≠ delivered.
 * Payout countdown starts ONLY from delivery_confirmed.
 * See: 08-order-lifecycle-rules.md, delivery-confirmation.ts
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import { NotFoundError, ConflictError } from '../lib/errors'
import { createOrderRepository } from '../repositories/order.repository'
import { createShipmentRepository } from '../repositories/shipment.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { assertTransition } from '../domain/order-state-machine'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import {
  buildCustomerConfirmation,
  buildAdminConfirmation,
  buildSilentConfirmation,
  isSilentConfirmationEligible,
} from '../domain/delivery-confirmation'
import { calculateHoldUntil } from '../domain/payout-calculator'
import { createPayoutService } from './payout.service'

interface DeliveryServiceDeps {
  prisma: PrismaClient
}

export function createDeliveryService({ prisma }: DeliveryServiceDeps) {
  const orders = createOrderRepository(prisma)
  const shipments = createShipmentRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  return {
    /**
     * Seller enters tracking number — transitions order to 'shipped'.
     */
    async enterTracking(params: {
      orderId: string
      sellerId: string
      trackingNumber: string
      cargoProvider?: string
    }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      assertTransition(order.status, 'shipped')

      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        let shipment = await shipments.findByOrderId(params.orderId)

        if (shipment) {
          await shipments.updateTracking(shipment.id, {
            trackingNumber: params.trackingNumber,
            ...(params.cargoProvider !== undefined ? { cargoProvider: params.cargoProvider } : {}),
          })
        } else {
          shipment = await shipments.create({
            orderId: params.orderId,
            sellerId: params.sellerId,
            cargoProvider: params.cargoProvider ?? 'unknown',
            trackingNumber: params.trackingNumber,
          })
        }

        await orders.updateStatus(params.orderId, 'shipped', tx as unknown as PrismaClient)
        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: { shippedAt: new Date() },
        })
        await orders.appendStatusHistory(
          params.orderId,
          'shipped',
          params.sellerId,
          `Kargo: ${params.trackingNumber}${params.cargoProvider ? ` (${params.cargoProvider})` : ''}`,
          tx as unknown as PrismaClient,
        )

        return shipment
      }).then(async (shipment) => {
        // Notify customer that order is shipped (fire-and-forget)
        void prisma.order.findUnique({
          where: { id: params.orderId },
          select: {
            customerId: true,
            customer: { select: { email: true, name: true } },
          },
        }).then((o) => {
          if (!o) return
          return enqueueNotification({
            userId: o.customerId,
            type: 'order_shipped',
            emailTo: o.customer.email ?? undefined,
            title: 'Siparişiniz Kargoya Verildi',
            body: `Takip numaranız: ${params.trackingNumber}`,
            data: {
              orderId: params.orderId,
              orderNumber: params.orderId.slice(-8).toUpperCase(),
              trackingNumber: params.trackingNumber,
              cargoCompany: params.cargoProvider ?? 'Kargo',
              customerName: o.customer.name ?? 'Değerli Müşterimiz',
            },
          })
        }).catch((err) => console.error('[delivery] Shipped notification failed:', err))
        return shipment
      })
    },

    /**
     * Mark order as delivered (cargo signal or admin).
     * This is NOT delivery_confirmed — payout countdown does NOT start here.
     */
    async markDelivered(params: { orderId: string; actorId: string }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      assertTransition(order.status, 'delivered')

      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const shipment = await shipments.findByOrderId(params.orderId)
        if (shipment) {
          await shipments.markDelivered(shipment.id)
        }

        await orders.updateStatus(params.orderId, 'delivered', tx as unknown as PrismaClient)
        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: { deliveredAt: new Date() },
        })
        await orders.appendStatusHistory(
          params.orderId,
          'delivered',
          params.actorId,
          'Kargo teslim edildi',
          tx as unknown as PrismaClient,
        )

        return orders.updateStatus(
          params.orderId,
          'delivery_confirmation_pending',
          tx as unknown as PrismaClient,
        )
      })
    },

    /**
     * Customer explicitly confirms delivery ("Teslim Aldım").
     * Payout countdown starts here.
     */
    async confirmByCustomer(params: { orderId: string; customerId: string }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.status !== 'delivered' && order.status !== 'delivery_confirmation_pending') {
        throw new ConflictError(`Teslimat onayı için uygun durum değil: ${order.status}`)
      }

      const confirmation = buildCustomerConfirmation()
      return this._applyDeliveryConfirmation(params.orderId, params.customerId, confirmation)
    },

    /**
     * Admin manually confirms delivery.
     * Must be auditable — requires adminActorId.
     */
    async confirmByAdmin(params: {
      orderId: string
      adminActorId: string
      reason?: string
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      const confirmation = buildAdminConfirmation()
      await this._applyDeliveryConfirmation(params.orderId, params.adminActorId, confirmation)

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'delivery_confirmed_manual',
        targetType: 'order',
        targetId: params.orderId,
        newData: { confirmedAt: confirmation.confirmedAt, source: 'admin_manual' },
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
      })
    },

    /**
     * Silent auto-confirmation — called by the delivery-silent-confirmation job.
     * Only proceeds if 72h elapsed and no open return/dispute.
     */
    async silentConfirm(orderId: string) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          returnRequests: true,
          disputes: true,
        },
      })
      if (!order) throw new NotFoundError('Order', orderId)

      const shipment = await shipments.findByOrderId(orderId)
      const deliveredAt = shipment?.deliveredAt ?? order.updatedAt

      const eligible = isSilentConfirmationEligible({
        deliveredAt,
        hasOpenReturn: order.returnRequests.some(
          (r) => r.status !== 'rejected' && r.status !== 'refund_completed',
        ),
        hasOpenDispute: order.disputes.some((d) => d.status === 'open'),
      })

      if (!eligible) return null

      const confirmation = buildSilentConfirmation()
      return this._applyDeliveryConfirmation(orderId, 'system', confirmation)
    },

    async _applyDeliveryConfirmation(
      orderId: string,
      actorId: string,
      confirmation: { confirmedAt: Date; source: string },
    ) {
      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await orders.setDeliveryConfirmed(orderId, confirmation.confirmedAt, tx as unknown as PrismaClient)
        await orders.appendStatusHistory(
          orderId,
          'delivery_confirmed',
          actorId,
          `Teslim onaylandı (${confirmation.source})`,
          tx as unknown as PrismaClient,
        )

        // Payout hold activation delegated to payout service
        // Called after transaction for clarity — payout service will do its own tx
        return { orderId, confirmedAt: confirmation.confirmedAt, source: confirmation.source }
      }).then(async (result) => {
        const payoutService = createPayoutService({ prisma })
        await payoutService.activateHold({
          orderId,
          deliveryConfirmedAt: result.confirmedAt,
        })

        // Notify customer about delivery confirmation (fire-and-forget)
        void prisma.order.findUnique({
          where: { id: orderId },
          select: { customerId: true },
        }).then((o) => {
          if (!o) return
          return enqueueNotification({
            userId: o.customerId,
            type: 'order_delivery_confirmed',
            title: 'Teslimat Onaylandı',
            body: 'Siparişinizin teslim alındığı onaylandı.',
            data: { orderId },
          })
        }).catch((err) => console.error('[delivery] Delivery confirmed notification failed:', err))
        return result
      })
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
