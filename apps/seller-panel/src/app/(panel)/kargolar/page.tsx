import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createShipmentService } from '@hanuja/api/services/shipment.service'
import { getSellerFromSession } from '@/lib/seller-session'
import ShipmentsPageClient, { type ShipmentListItem } from './_components/shipments-page-client'

export const dynamic = 'force-dynamic'

function serializeShipments(
  shipments: Awaited<ReturnType<ReturnType<typeof createShipmentService>['listShipmentsForSeller']>>,
): ShipmentListItem[] {
  return shipments.map((shipment) => ({
    id: shipment.id,
    orderId: shipment.orderId,
    cargoProvider: shipment.cargoProvider,
    trackingNumber: shipment.trackingNumber,
    status: shipment.status,
    handedAt: shipment.handedAt?.toISOString() ?? null,
    deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
    createdAt: shipment.createdAt.toISOString(),
    order: {
      id: shipment.order.id,
      publicNumber: shipment.order.publicNumber,
      status: shipment.order.status,
      totalAmount: shipment.order.totalAmount.toString(),
    },
    events: shipment.events.map((event) => ({
      status: event.status,
      description: event.description,
      occurredAt: event.occurredAt.toISOString(),
    })),
  }))
}

export default async function ShipmentsPage() {
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const shipmentService = createShipmentService({ prisma })
  const shipments = await shipmentService.listShipmentsForSeller(seller.id)

  return <ShipmentsPageClient initialShipments={serializeShipments(shipments)} />
}
