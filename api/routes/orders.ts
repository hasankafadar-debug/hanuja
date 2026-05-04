/**
 * Order route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/, not here.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, handleError } from '../lib/response'
import { UnauthorizedError, ForbiddenError } from '../lib/errors'
import { createOrderService } from '../services/order.service'
import { createPrismaForRoute } from '../lib/prisma'
import { getSellerOrderStatusesForTab, isSellerOrderTab } from '../domain/seller-order-tabs'

// Schema definitions
const sellerRejectSchema = z.object({
  reason: z.string().min(5, 'Ret gerekçesi en az 5 karakter olmalı'),
})

function getOrderService() {
  const prisma = createPrismaForRoute()
  return createOrderService({ prisma })
}

// GET /api/orders — customer order list
export async function listCustomerOrders(req: NextRequest, customerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '10')
    const svc = getOrderService()
    const orders = await svc.listForCustomer(customerId, skip, take)
    return ok(orders)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/orders/:id — customer order detail
export async function getCustomerOrder(orderId: string, customerId: string) {
  try {
    const svc = getOrderService()
    const order = await svc.getOrderForCustomer(orderId, customerId)
    return ok(order)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/orders/:id/cancel — customer pre-shipment cancel
export async function cancelOrderAsCustomer(orderId: string, customerId: string) {
  try {
    const svc = getOrderService()
    await svc.customerCancel({ orderId, customerId })
    return ok({ cancelled: true })
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/seller/orders — seller order queue
export async function listSellerOrders(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const query = url.searchParams.get('q')?.trim() ?? undefined
    const tabParam = url.searchParams.get('tab')?.trim()
    const fromParam = url.searchParams.get('from')?.trim()
    const toParam = url.searchParams.get('to')?.trim()
    const svc = getOrderService()
    const orders = await svc.listForSellerQueue({
      sellerId,
      ...(query ? { query } : {}),
      ...(tabParam && isSellerOrderTab(tabParam) ? { status: getSellerOrderStatusesForTab(tabParam) } : {}),
      ...(fromParam ? { from: new Date(`${fromParam}T00:00:00.000Z`) } : {}),
      ...(toParam ? { to: new Date(`${toParam}T23:59:59.999Z`) } : {}),
      skip,
      take,
    })
    return ok(orders)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/orders/:id/accept
export async function acceptOrderAsSeller(orderId: string, sellerId: string) {
  try {
    const svc = getOrderService()
    await svc.sellerAccept({ orderId, sellerId })
    return ok({ accepted: true })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/orders/:id/reject
export async function rejectOrderAsSeller(
  req: NextRequest,
  orderId: string,
  sellerId: string,
) {
  try {
    const body = await req.json()
    const { reason } = sellerRejectSchema.parse(body)
    const svc = getOrderService()
    await svc.sellerReject({ orderId, sellerId, reason })
    return ok({ rejected: true })
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/orders/:id/cancel
export async function cancelOrderAsAdmin(
  req: NextRequest,
  orderId: string,
  adminActorId: string,
) {
  try {
    const body = await req.json()
    const { reason } = z.object({ reason: z.string().min(5) }).parse(body)
    const svc = getOrderService()
    await svc.adminCancel({ orderId, adminActorId, reason })
    return ok({ cancelled: true })
  } catch (err) {
    return handleError(err)
  }
}
