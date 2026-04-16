/**
 * Shipment route handlers — seller kargo yönetimi.
 * Business logic lives in api/services/shipment.service.ts + delivery.service.ts
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { createShipmentService } from '../services/shipment.service'
import { createDeliveryService } from '../services/delivery.service'
import { createPrismaForRoute } from '../lib/prisma'

const markPreparingSchema = z.object({
  orderId: z.string().min(1),
})

const markAwaitingSchema = z.object({
  orderId: z.string().min(1),
  cargoProvider: z.string().min(1),
  estimatedDeliveryAt: z.string().optional(), // ISO date string
})

const enterTrackingSchema = z.object({
  orderId: z.string().min(1),
  trackingNumber: z.string().min(3),
  cargoProvider: z.string().optional(),
})

function getServices() {
  const prisma = createPrismaForRoute()
  return {
    shipment: createShipmentService({ prisma }),
    delivery: createDeliveryService({ prisma }),
  }
}

// GET /api/seller/shipments — satıcı kargo listesi
export async function listSellerShipments(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const { shipment } = getServices()
    const result = await shipment.listShipmentsForSeller(sellerId, { skip, take })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/shipments/preparing — sipariş hazırlanıyor
export async function startPreparing(req: NextRequest, sellerId: string) {
  try {
    const body = markPreparingSchema.parse(await req.json())
    const { shipment } = getServices()
    const result = await shipment.startPreparing({ orderId: body.orderId, sellerId })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/shipments/awaiting — kargo bekleniyor
export async function markAwaitingShipment(req: NextRequest, sellerId: string) {
  try {
    const body = markAwaitingSchema.parse(await req.json())
    const { shipment } = getServices()
    const result = await shipment.markAwaitingShipment({
      orderId: body.orderId,
      sellerId,
      cargoProvider: body.cargoProvider,
      ...(body.estimatedDeliveryAt !== undefined
        ? { estimatedDeliveryAt: new Date(body.estimatedDeliveryAt) }
        : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/shipments/tracking — takip numarası gir (awaiting → shipped)
export async function enterTracking(req: NextRequest, sellerId: string) {
  try {
    const body = enterTrackingSchema.parse(await req.json())
    const { delivery } = getServices()
    const result = await delivery.enterTracking({
      orderId: body.orderId,
      sellerId,
      trackingNumber: body.trackingNumber,
      ...(body.cargoProvider !== undefined ? { cargoProvider: body.cargoProvider } : {}),
    })
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/seller/shipments/:orderId — sipariş kargosu detayı
export async function getShipmentForSeller(orderId: string, sellerId: string) {
  try {
    const { shipment } = getServices()
    const result = await shipment.getShipmentForSeller(orderId, sellerId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
