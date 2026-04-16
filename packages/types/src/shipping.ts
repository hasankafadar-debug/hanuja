export type ShipmentStatus =
  | 'preparing'
  | 'handed_to_cargo'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivered'
  | 'delivery_failed'
  | 'returned_to_sender'

export type Shipment = {
  id: string
  orderId: string
  sellerId: string
  cargoProvider: string
  trackingNumber: string
  status: ShipmentStatus
  handedAt: Date | null
  createdAt: Date
}
