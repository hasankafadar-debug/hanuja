import { NextRequest } from 'next/server'
import { z } from 'zod'
import { createPrismaForRoute } from '../lib/prisma'
import { handleError, ok } from '../lib/response'
import { createFavoriteProductService } from '../services/favorite-product.service'

const favoriteBodySchema = z.object({
  productId: z.string().min(1).max(128),
})

function getFavoriteService() {
  return createFavoriteProductService({ prisma: createPrismaForRoute() })
}

export async function listFavorites(userId: string) {
  try {
    const svc = getFavoriteService()
    const favorites = await svc.listFavorites(userId)
    return ok(favorites)
  } catch (err) {
    return handleError(err)
  }
}

export async function listFavoriteIds(userId: string) {
  try {
    const svc = getFavoriteService()
    const productIds = await svc.listFavoriteIds(userId)
    return ok(productIds)
  } catch (err) {
    return handleError(err)
  }
}

export async function getFavoriteStatus(userId: string, productId: string) {
  try {
    const svc = getFavoriteService()
    const status = await svc.isFavorite(userId, productId)
    return ok(status)
  } catch (err) {
    return handleError(err)
  }
}

export async function addFavorite(req: NextRequest, userId: string) {
  try {
    const body = favoriteBodySchema.parse(await req.json())
    const svc = getFavoriteService()
    const result = await svc.addFavorite(userId, body.productId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

export async function removeFavorite(userId: string, productId: string) {
  try {
    const svc = getFavoriteService()
    const result = await svc.removeFavorite(userId, productId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}
