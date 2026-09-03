/**
 * Delivery Service — shipment entry, delivery confirmation logic.
 *
 * KEY INVARIANT: delivery_confirmed ≠ delivered.
 * Payout countdown starts ONLY from delivery_confirmed.
 * See: 08-order-lifecycle-rules.md, delivery-confirmation.ts
 */
import { Prisma, type PrismaClient } from '@prisma/client'
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
import { formatOrderNumber } from '../lib/order-number'
import { getWebBaseUrl } from '../lib/platform-info'
import { formatMoney } from '@hanuja/security/money'

interface DeliveryServiceDeps {
  prisma: PrismaClient
}

export function createDeliveryService({ prisma }: DeliveryServiceDeps) {
  const orders = createOrderRepository(prisma)
  const shipments = createShipmentRepository(prisma)
  const auditLog = createAdminAuditLogRepository(prisma)

  async function notifyShipped(params: {
    orderId: string
    sellerId: string
    trackingNumber: string
    cargoProvider?: string
  }) {
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        publicNumber: true,
        customerId: true,
        customer: { select: { email: true, name: true } },
        lines: {
          where: { sellerId: params.sellerId, shippedQuantity: { gt: 0 } },
          select: {
            productName: true,
            variantName: true,
            shippedQuantity: true,
            unitPrice: true,
          },
        },
      },
    })
    if (!order) return
    await enqueueNotification({
      eventKey: `order:${order.id}:shipped:${params.sellerId}:${params.trackingNumber}`,
      userId: order.customerId,
      type: 'order_shipped',
      emailTo: order.customer.email ?? undefined,
      title: 'Siparişiniz Kargoya Verildi',
      body: `Takip numaranız: ${params.trackingNumber}`,
      data: {
        orderId: params.orderId,
        orderNumber: formatOrderNumber(order.publicNumber, order.id),
        trackingNumber: params.trackingNumber,
        cargoCompany: params.cargoProvider ?? 'Kargo',
        customerName: order.customer.name ?? 'Değerli Müşterimiz',
        sellerId: params.sellerId,
        orderUrl: `${getWebBaseUrl()}/siparis/${order.id}`,
        items: order.lines.map((line) => ({
          productName: line.productName,
          variantName: line.variantName,
          quantity: line.shippedQuantity,
          unitPrice: formatMoney(line.unitPrice.toNumber()),
          lineTotal: formatMoney(
            line.unitPrice.mul(line.shippedQuantity).toNumber(),
          ),
        })),
      },
    })
  }

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

      if (order.quantityLifecycleVersion === 2) {
        const shipment = await prisma
          .$transaction(
            async (tx) => {
              const fulfillment = await tx.orderSellerFulfillment.findUnique({
                where: {
                  orderId_sellerId: {
                    orderId: params.orderId,
                    sellerId: params.sellerId,
                  },
                },
              })
              if (!fulfillment || fulfillment.status !== 'awaiting_shipment') {
                throw new ConflictError('Bu satıcı gönderisi kargoya verilebilecek durumda değil')
              }

              const lines = await tx.orderLine.findMany({
                where: { orderId: params.orderId, sellerId: params.sellerId },
              })
              const activeLines = lines
                .map((line) => ({
                  line,
                  quantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
                }))
                .filter((item) => item.quantity > 0)
              if (activeLines.length === 0) {
                throw new ConflictError('Kargoya verilebilecek aktif ürün adedi kalmadı')
              }

              const shippedAt = new Date()
              const currentShipment = await tx.shipment.upsert({
                where: {
                  orderId_sellerId: {
                    orderId: params.orderId,
                    sellerId: params.sellerId,
                  },
                },
                create: {
                  orderId: params.orderId,
                  sellerId: params.sellerId,
                  cargoProvider: params.cargoProvider ?? 'unknown',
                  trackingNumber: params.trackingNumber,
                  status: 'handed_to_cargo',
                  handedAt: shippedAt,
                },
                update: {
                  cargoProvider: params.cargoProvider ?? 'unknown',
                  trackingNumber: params.trackingNumber,
                  status: 'handed_to_cargo',
                  handedAt: shippedAt,
                },
              })

              for (const item of activeLines) {
                const changed = await tx.orderLine.updateMany({
                  where: {
                    id: item.line.id,
                    cancelledQuantity: item.line.cancelledQuantity,
                    shippedQuantity: item.line.shippedQuantity,
                  },
                  data: {
                    shippedQuantity: { increment: item.quantity },
                    fulfilledAt: shippedAt,
                  },
                })
                if (changed.count !== 1) {
                  throw new ConflictError(
                    'İptal ile kargoya verme işlemi çakıştı; güncel durumu yenileyin',
                  )
                }
                await tx.shipmentItem.create({
                  data: {
                    shipmentId: currentShipment.id,
                    orderLineId: item.line.id,
                    quantity: item.quantity,
                  },
                })
              }

              const fulfillmentChanged = await tx.orderSellerFulfillment.updateMany({
                where: { id: fulfillment.id, status: 'awaiting_shipment' },
                data: { status: 'shipped', shippedAt },
              })
              if (fulfillmentChanged.count !== 1) {
                throw new ConflictError('Gönderi durumu başka bir işlemle değişti')
              }

              await tx.order.update({
                where: { id: params.orderId },
                data: {
                  status: 'shipped',
                  shippedAt: order.shippedAt ?? shippedAt,
                },
              })
              await orders.appendStatusHistory(
                params.orderId,
                'shipped',
                params.sellerId,
                `Satıcı gönderisi kargoya verildi: ${params.trackingNumber}`,
                tx as unknown as PrismaClient,
              )
              return currentShipment
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
          .catch((error) => {
            const concurrent =
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'P2034'
            if (concurrent) {
              throw new ConflictError(
                'İptal ile kargoya verme işlemi çakıştı; güncel durumu yenileyin',
              )
            }
            throw error
          })

        void notifyShipped(params).catch((error) =>
          console.error('[delivery] Shipped notification failed:', error),
        )
        return shipment
      }

      assertTransition(order.status, 'shipped')

      return prisma
        .$transaction(async (tx: Prisma.TransactionClient) => {
          const shippedAt = new Date()
          let shipment = await shipments.findByOrderAndSeller(params.orderId, params.sellerId, tx)

          if (shipment) {
            await shipments.updateTracking(
              shipment.id,
              {
                trackingNumber: params.trackingNumber,
                ...(params.cargoProvider !== undefined
                  ? { cargoProvider: params.cargoProvider }
                  : {}),
              },
              tx,
            )
          } else {
            shipment = await shipments.create(
              {
                orderId: params.orderId,
                sellerId: params.sellerId,
                cargoProvider: params.cargoProvider ?? 'unknown',
                trackingNumber: params.trackingNumber,
              },
              tx,
            )
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
        })
        .then((shipment) => {
          void notifyShipped(params).catch((error) =>
            console.error('[delivery] Shipped notification failed:', error),
          )
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
        const deliveredAt = new Date()
        if (order.quantityLifecycleVersion === 2) {
          await tx.shipment.updateMany({
            where: { orderId: params.orderId, status: { not: 'delivered' } },
            data: { status: 'delivered', deliveredAt },
          })
          await tx.orderSellerFulfillment.updateMany({
            where: { orderId: params.orderId, status: 'shipped' },
            data: {
              status: 'delivery_confirmation_pending',
              deliveredAt,
            },
          })
        } else {
          const shipment = await shipments.findByOrderId(params.orderId, tx)
          if (shipment) {
            await shipments.markDelivered(shipment.id, deliveredAt, tx)
          }
        }

        await orders.updateStatus(params.orderId, 'delivered', tx as unknown as PrismaClient)
        await (tx as PrismaClient).order.update({
          where: { id: params.orderId },
          data: { deliveredAt },
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
        const lifecycle = await tx.order.findUnique({
          where: { id: orderId },
          select: { quantityLifecycleVersion: true },
        })
        if (!lifecycle) throw new NotFoundError('Order', orderId)
        const isQuantityLifecycle = lifecycle.quantityLifecycleVersion === 2
        const orderLineWhere: Prisma.OrderLineWhereInput = {
          orderId,
          deliveryConfirmedAt: null,
          ...(isQuantityLifecycle ? { shippedQuantity: { gt: 0 } } : {}),
          ...(orderLineIds && orderLineIds.length > 0 ? { id: { in: orderLineIds } } : {}),
        }

        const linesToStamp = await (tx as PrismaClient).orderLine.findMany({
          where: orderLineWhere,
          select: { id: true, sellerId: true },
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
          where: {
            orderId,
            deliveryConfirmedAt: null,
            ...(isQuantityLifecycle ? { shippedQuantity: { gt: 0 } } : {}),
          },
        })
        const allLinesConfirmed = remainingUnconfirmed === 0 && stampedIds.length > 0

        if (isQuantityLifecycle && linesToStamp.length > 0) {
          for (const sellerId of [...new Set(linesToStamp.map((line) => line.sellerId))]) {
            const sellerRemaining = await tx.orderLine.count({
              where: {
                orderId,
                sellerId,
                shippedQuantity: { gt: 0 },
                deliveryConfirmedAt: null,
              },
            })
            if (sellerRemaining === 0) {
              await tx.orderSellerFulfillment.updateMany({
                where: {
                  orderId,
                  sellerId,
                  status: { notIn: ['cancelled', 'delivery_confirmed'] },
                },
                data: {
                  status: 'delivery_confirmed',
                  deliveryConfirmedAt: confirmation.confirmedAt,
                },
              })
            }
          }
        }

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
