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
        const shippedAt = new Date()
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
          data: { shippedAt },
        })
        await (tx as PrismaClient).orderLine.updateMany({
          where: {
            orderId: params.orderId,
            sellerId: params.sellerId,
            fulfilledAt: null,
          },
          data: { fulfilledAt: shippedAt },
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
     * Admin manually confirms delivery. When `orderLineIds` is provided, only
     * those lines are stamped — the order moves to `delivery_confirmed` and
     * payout hold is activated only when ALL active lines are confirmed.
     * Without `orderLineIds`, behaviour matches the legacy order-level path.
     * Must be auditable — requires adminActorId.
     */
    async confirmByAdmin(params: {
      orderId: string
      adminActorId: string
      orderLineIds?: string[]
      reason?: string
    }) {
      const order = await orders.findById(params.orderId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      // Status guard — admin can only manually confirm delivery from a state
      // that already implies the order has reached (or is reaching) the
      // customer. Confirming earlier states would prematurely start the
      // payout countdown.
      const ALLOWED_STATUSES = ['shipped', 'delivered', 'delivery_confirmation_pending'] as const
      if (!ALLOWED_STATUSES.includes(order.status as (typeof ALLOWED_STATUSES)[number])) {
        throw new ConflictError(`Admin teslimat onayı için uygun durum değil: ${order.status}`)
      }

      const confirmation = buildAdminConfirmation()
      const result = await this._applyDeliveryConfirmation(
        params.orderId,
        params.adminActorId,
        confirmation,
        params.orderLineIds,
      )

      await auditLog.createEntry({
        actorId: params.adminActorId,
        actionType: 'delivery_confirmed_manual',
        targetType: 'order',
        targetId: params.orderId,
        newData: {
          confirmedAt: confirmation.confirmedAt,
          source: 'admin_manual',
          orderLevel: result.allLinesConfirmed,
          ...(params.orderLineIds !== undefined ? { orderLineIds: params.orderLineIds } : {}),
        },
        ...(params.reason !== undefined ? { reason: params.reason } : {}),
      })

      return result
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
      orderLineIds?: string[],
    ): Promise<{
      orderId: string
      confirmedAt: Date
      source: string
      allLinesConfirmed: boolean
      confirmedLineIds: string[]
    }> {
      const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const orderLineWhere: Prisma.OrderLineWhereInput = {
          orderId,
          deliveryConfirmedAt: null,
          ...(orderLineIds && orderLineIds.length > 0 ? { id: { in: orderLineIds } } : {}),
        }

        const linesToStamp = await (tx as PrismaClient).orderLine.findMany({
          where: orderLineWhere,
          select: { id: true },
        })
        const stampedIds = linesToStamp.map((l) => l.id)

        if (stampedIds.length > 0) {
          await (tx as PrismaClient).orderLine.updateMany({
            where: { id: { in: stampedIds } },
            data: {
              deliveryConfirmedAt: confirmation.confirmedAt,
              deliveryConfirmedBy: actorId,
            },
          })
        }

        // Determine whether ALL active lines are now confirmed. If yes, move
        // order to delivery_confirmed and activate payout hold (caller side).
        const remainingUnconfirmed = await (tx as PrismaClient).orderLine.count({
          where: { orderId, deliveryConfirmedAt: null },
        })
        const allLinesConfirmed = remainingUnconfirmed === 0 && stampedIds.length > 0

        if (allLinesConfirmed) {
          await orders.setDeliveryConfirmed(orderId, confirmation.confirmedAt, tx as unknown as PrismaClient)
          await orders.appendStatusHistory(
            orderId,
            'delivery_confirmed',
            actorId,
            `Teslim onaylandı (${confirmation.source})`,
            tx as unknown as PrismaClient,
          )
        } else if (stampedIds.length > 0) {
          await orders.appendStatusHistory(
            orderId,
            'delivery_confirmation_pending',
            actorId,
            `${stampedIds.length} kalem teslim onaylandı (${confirmation.source}); kalan ${remainingUnconfirmed} kalem bekleniyor`,
            tx as unknown as PrismaClient,
          )
        }

        return {
          orderId,
          confirmedAt: confirmation.confirmedAt,
          source: confirmation.source,
          allLinesConfirmed,
          confirmedLineIds: stampedIds,
        }
      })

      if (txResult.allLinesConfirmed) {
        const payoutService = createPayoutService({ prisma })
        await payoutService.activateHold({
          orderId,
          deliveryConfirmedAt: txResult.confirmedAt,
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
      }

      return txResult
    },
  }
}

export type DeliveryService = ReturnType<typeof createDeliveryService>
