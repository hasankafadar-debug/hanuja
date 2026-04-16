/**
 * Cart route handlers — thin: validate → auth → service → respond.
 * Business logic lives in api/services/cart.service.ts
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, noContent, handleError } from '../lib/response'
import { createCartService } from '../services/cart.service'
import { createPrismaForRoute } from '../lib/prisma'

const addItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  variantId: z.string().optional(),
})

const updateQuantitySchema = z.object({
  quantity: z.number().int().min(1).max(99),
})

const applyCouponSchema = z.object({
  couponCode: z.string().min(1).max(50),
})

function getCartService() {
  return createCartService({ prisma: createPrismaForRoute() })
}

// GET /api/cart
export async function getCart(userId: string) {
  try {
    const svc = getCartService()
    const cart = await svc.getCart(userId)
    return ok(cart)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/cart/items
export async function addCartItem(req: NextRequest, userId: string) {
  try {
    const body = addItemSchema.parse(await req.json())
    const svc = getCartService()
    const item = await svc.addItem({
      userId,
      productId: body.productId,
      quantity: body.quantity,
      ...(body.variantId !== undefined ? { variantId: body.variantId } : {}),
    })
    return ok(item, 201)
  } catch (err) {
    return handleError(err)
  }
}

// PATCH /api/cart/items/:itemId
export async function updateCartItem(
  req: NextRequest,
  userId: string,
  itemId: string,
) {
  try {
    const body = updateQuantitySchema.parse(await req.json())
    const svc = getCartService()
    const item = await svc.updateQuantity({ userId, itemId, quantity: body.quantity })
    return ok(item)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart/items/:itemId
export async function removeCartItem(userId: string, itemId: string) {
  try {
    const svc = getCartService()
    await svc.removeItem({ userId, itemId })
    return noContent()
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart
export async function clearCart(userId: string) {
  try {
    const svc = getCartService()
    await svc.clearCart(userId)
    return noContent()
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/cart/coupon
export async function applyCoupon(req: NextRequest, userId: string) {
  try {
    const body = applyCouponSchema.parse(await req.json())
    const svc = getCartService()
    const cart = await svc.applyCoupon(userId, body.couponCode)
    return ok(cart)
  } catch (err) {
    return handleError(err)
  }
}

// DELETE /api/cart/coupon
export async function removeCoupon(userId: string) {
  try {
    const svc = getCartService()
    await svc.removeCoupon(userId)
    return noContent()
  } catch (err) {
    return handleError(err)
  }
}
