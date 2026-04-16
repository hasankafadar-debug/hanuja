/**
 * Shipment Service — satıcı tarafı kargo hazırlık ve yönetim akışı.
 *
 * Delivery Service'ten ayrılır:
 * - ShipmentService: seller_accepted → preparing → awaiting_shipment + kargo kaydı
 * - DeliveryService: awaiting_shipment → shipped (tracking girişi) → delivered → delivery_confirmed
 *
 * See: shipping-cargo-flow skill, 08-order-lifecycle-rules.md
 */
import type { PrismaClient, Prisma } from '@prisma/client'
import type { ShipmentStatus } from '@prisma/client'
import { NotFoundError, ForbiddenError, ConflictError } from '../lib/errors'
import { createOrderRepository } from '../repositories/order.repository'
import { createShipmentRepository } from '../repositories/shipment.repository'
import { assertTransition } from '../domain/order-state-machine'

interface ShipmentServiceDeps {
  prisma: PrismaClient
}

const VALID_CARGO_PROVIDERS = [
  'yurtiçi',
  'aras',
  'ptt',
  'mng',
  'sürat',
  'ups',
  'fedex',
  'dhl',
] as const

export type CargoProvider = (typeof VALID_CARGO_PROVIDERS)[number]

export function createShipmentService({ prisma }: ShipmentServiceDeps) {
  const orders = createOrderRepository(prisma)
  const shipments = createShipmentRepository(prisma)

  return {
    /**
     * Satıcı siparişi hazırlamaya başlar: seller_accepted → preparing.
     */
    async startPreparing(params: { orderId: string; sellerId: string }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Sipariş', params.orderId)

      assertTransition(order.status, 'preparing')

      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await orders.updateStatus(params.orderId, 'preparing', tx as unknown as PrismaClient)
        return orders.appendStatusHistory(
          params.orderId,
          'preparing',
          params.sellerId,
          'Satıcı hazırlamaya başladı',
          tx as unknown as PrismaClient,
        )
      })
    },

    /**
     * Satıcı kargo teslim bekleniyor durumuna alır: preparing → awaiting_shipment.
     * Kargo firması ve tahmini teslimat tarihi burada girilir.
     */
    async markAwaitingShipment(params: {
      orderId: string
      sellerId: string
      cargoProvider: string
      estimatedDeliveryAt?: Date
    }) {
      const order = await orders.findByIdForSeller(params.orderId, params.sellerId)
      if (!order) throw new NotFoundError('Sipariş', params.orderId)

      assertTransition(order.status, 'awaiting_shipment')

      return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Kargo kaydını oluştur (tracking number henüz girilmeden)
        const existingShipment = await shipments.findByOrderId(params.orderId)
        if (!existingShipment) {
          await shipments.create({
            orderId: params.orderId,
            sellerId: params.sellerId,
            cargoProvider: params.cargoProvider,
          })
        }

        await orders.updateStatus(params.orderId, 'awaiting_shipment', tx as unknown as PrismaClient)
        return orders.appendStatusHistory(
          params.orderId,
          'awaiting_shipment',
          params.sellerId,
          `Kargo için hazır. Firma: ${params.cargoProvider}`,
          tx as unknown as PrismaClient,
        )
      })
    },

    /**
     * Satıcının sipariş sevkiyatını görüntüler.
     * Yalnızca kendi siparişlerine erişebilir.
     */
    async getShipmentForSeller(orderId: string, sellerId: string) {
      const order = await orders.findByIdForSeller(orderId, sellerId)
      if (!order) throw new NotFoundError('Sipariş', orderId)
      return shipments.findByOrderId(orderId)
    },

    /**
     * Kargo firmasının yaptığı durum güncellemesini kaydeder.
     * Kargo entegrasyonu veya satıcı manuel güncelleme için kullanılır.
     */
    async addShipmentEvent(params: {
      shipmentId: string
      status: ShipmentStatus
      location?: string
      description?: string
      source?: 'cargo_integration' | 'manual' | 'admin'
      occurredAt?: Date
    }) {
      const shipment = await shipments.findById(params.shipmentId)
      if (!shipment) throw new NotFoundError('Kargo', params.shipmentId)

      // Kargo durumunu güncelle
      await shipments.updateStatus(params.shipmentId, params.status)

      // Kargo olay kaydı ekle
      return prisma.shipmentEvent.create({
        data: {
          shipmentId: params.shipmentId,
          status: params.status,
          source: params.source ?? 'manual',
          occurredAt: params.occurredAt ?? new Date(),
          ...(params.location !== undefined ? { location: params.location } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
        },
      })
    },

    /**
     * Satıcının siparişlerinin kargo özetini döndürür.
     * Kargolar sayfası için kullanılır.
     */
    async listShipmentsForSeller(
      sellerId: string,
      params: { skip?: number; take?: number } = {},
    ) {
      return prisma.shipment.findMany({
        where: { sellerId },
        include: {
          order: {
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
            },
          },
          events: {
            orderBy: { occurredAt: 'desc' },
            take: 1, // Son event
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 20,
      })
    },

    /**
     * Tüm kargo firmalarının listesini döndürür.
     */
    getCargoProviders() {
      return VALID_CARGO_PROVIDERS
    },
  }
}

export type ShipmentService = ReturnType<typeof createShipmentService>
