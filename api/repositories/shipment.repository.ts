import type { Prisma, PrismaClient, ShipmentStatus } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export function createShipmentRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.shipment.findUnique({
        where: { id },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      })
    },

    findByOrderId(orderId: string, tx?: DbClient) {
      return (tx ?? prisma).shipment.findFirst({ where: { orderId } })
    },

    findByOrderAndSeller(orderId: string, sellerId: string, tx?: DbClient) {
      return (tx ?? prisma).shipment.findUnique({
        where: { orderId_sellerId: { orderId, sellerId } },
      })
    },

    create(data: {
      orderId: string
      sellerId: string
      cargoProvider: string
      trackingNumber?: string
      estimatedDeliveryAt?: Date
    }, tx?: DbClient) {
      return (tx ?? prisma).shipment.create({
        data: {
          orderId: data.orderId,
          sellerId: data.sellerId,
          cargoProvider: data.cargoProvider,
          ...(data.trackingNumber !== undefined ? { trackingNumber: data.trackingNumber } : {}),
          ...(data.estimatedDeliveryAt !== undefined ? { estimatedDeliveryAt: data.estimatedDeliveryAt } : {}),
        },
      })
    },

    updateTracking(
      id: string,
      data: { trackingNumber: string; cargoProvider?: string; status?: ShipmentStatus; handedAt?: Date },
      tx?: DbClient,
    ) {
      return (tx ?? prisma).shipment.update({
        where: { id },
        data: {
          trackingNumber: data.trackingNumber,
          ...(data.cargoProvider !== undefined ? { cargoProvider: data.cargoProvider } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.handedAt !== undefined ? { handedAt: data.handedAt } : {}),
        },
      })
    },

    updateStatus(id: string, status: ShipmentStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.shipment.update({ where: { id }, data: { status } })
    },

    markDelivered(id: string, deliveredAt = new Date(), tx?: DbClient) {
      return (tx ?? prisma).shipment.update({
        where: { id },
        data: { status: 'delivered', deliveredAt },
      })
    },

    appendEvent(data: {
      shipmentId: string
      status: ShipmentStatus
      location?: string
      description?: string
      source?: string
      occurredAt?: Date
    }) {
      return prisma.shipmentEvent.create({
        data: {
          shipmentId: data.shipmentId,
          status: data.status,
          occurredAt: data.occurredAt ?? new Date(),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.source !== undefined ? { source: data.source } : {}),
        },
      })
    },
  }
}

export type ShipmentRepository = ReturnType<typeof createShipmentRepository>
