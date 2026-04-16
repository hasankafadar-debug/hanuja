import type { OrderStatus, PrismaClient } from '@prisma/client'

export function createOrderRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.order.findUnique({
        where: { id },
        include: {
          lines: { include: { product: true } },
          payments: true,
          shipments: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      })
    },

    /** Customer can only view their own orders */
    findByIdForCustomer(id: string, customerId: string) {
      return prisma.order.findUnique({
        where: { id, customerId },
        include: {
          lines: { include: { product: { include: { images: { take: 1 } } } } },
          payments: true,
          shipments: true,
        },
      })
    },

    /** Seller sees only payment_confirmed+ orders for their products */
    findByIdForSeller(id: string, sellerId: string) {
      return prisma.order.findUnique({
        where: {
          id,
          lines: { some: { sellerId } },
          status: {
            notIn: [
              'draft',
              'checkout_started',
              'payment_pending',
              'payment_failed',
              'payment_cancelled',
              'bank_transfer_waiting',
            ],
          },
        },
        include: {
          lines: { where: { sellerId }, include: { product: true } },
          shipments: true,
        },
      })
    },

    listByCustomer(params: {
      customerId: string
      status?: OrderStatus
      skip?: number
      take?: number
    }) {
      return prisma.order.findMany({
        where: {
          customerId: params.customerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { lines: { include: { product: { include: { images: { take: 1 } } } } } },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 10,
      })
    },

    /** Seller queue — payment-confirmed orders only */
    listForSellerQueue(params: {
      sellerId: string
      status?: OrderStatus[]
      skip?: number
      take?: number
    }) {
      const sellerVisibleStatuses = params.status ?? [
        'seller_queue_ready',
        'seller_reviewing',
        'seller_accepted',
        'preparing',
        'awaiting_shipment',
        'shipped',
        'delivered',
        'delivery_confirmation_pending',
        'delivery_confirmed',
      ]
      return prisma.order.findMany({
        where: {
          lines: { some: { sellerId: params.sellerId } },
          status: { in: sellerVisibleStatuses },
        },
        include: {
          lines: {
            where: { sellerId: params.sellerId },
            include: { product: { include: { images: { take: 1 } } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    listForAdmin(params: {
      status?: OrderStatus
      sellerId?: string
      customerId?: string
      skip?: number
      take?: number
    }) {
      return prisma.order.findMany({
        where: {
          ...(params.status !== undefined ? { status: params.status } : {}),
          ...(params.customerId !== undefined ? { customerId: params.customerId } : {}),
          ...(params.sellerId !== undefined
            ? { lines: { some: { sellerId: params.sellerId } } }
            : {}),
        },
        include: { lines: true, payments: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    updateStatus(id: string, status: OrderStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.order.update({ where: { id }, data: { status } })
    },

    appendStatusHistory(
      orderId: string,
      toStatus: OrderStatus,
      actorId: string,
      note?: string,
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.orderStatusHistory.create({
        data: { orderId, toStatus, actorId, ...(note !== undefined ? { note } : {}) },
      })
    },

    setDeliveryConfirmed(id: string, confirmedAt: Date, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.order.update({
        where: { id },
        data: { status: 'delivery_confirmed', deliveryConfirmedAt: confirmedAt },
      })
    },

    /** Find delivered orders eligible for silent confirmation */
    findEligibleForSilentConfirmation(deliveredBefore: Date) {
      return prisma.order.findMany({
        where: {
          status: 'delivered',
          deliveredAt: { lte: deliveredBefore },
        },
        include: {
          returnRequests: { where: { status: { not: 'rejected' } } },
          disputes: { where: { status: 'open' } },
        },
      })
    },

    /** Find orders at risk of 20-day breach */
    findAtFulfillmentRisk(paymentConfirmedBefore: Date) {
      return prisma.order.findMany({
        where: {
          status: {
            in: ['seller_queue_ready', 'seller_reviewing', 'seller_accepted', 'preparing', 'awaiting_shipment'],
          },
          paymentConfirmedAt: { lte: paymentConfirmedBefore },
        },
      })
    },
  }
}

export type OrderRepository = ReturnType<typeof createOrderRepository>
