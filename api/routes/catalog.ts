/**
 * Catalog route handlers — products and categories.
 */
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createCatalogService } from '../services/catalog.service'
import { createPrismaForRoute } from '../lib/prisma'
import { Decimal } from '@prisma/client/runtime/client'
import { ValidationError } from '../lib/errors'

function getCatalogService() {
  return createCatalogService({ prisma: createPrismaForRoute() })
}

const createProductSchema = z.object({
  categoryId: z.string().cuid(),
  name: z.string().min(3).max(200),
  description: z.string().min(10),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  slugOverride: z.string().optional(),
})

// GET /api/products/:slug — storefront product detail
export async function getProductBySlug(slug: string) {
  try {
    const svc = getCatalogService()
    const product = await svc.getProductBySlug(slug)
    return ok(product)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/products — storefront listing
export async function listProducts(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const categoryId = url.searchParams.get('categoryId') ?? undefined
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getCatalogService()
    const products = await svc.listPublished({ ...(categoryId !== undefined ? { categoryId } : {}), skip, take })
    return ok(products)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/seller/products — seller product list
export async function listSellerProducts(req: NextRequest, sellerId: string) {
  try {
    const url = new URL(req.url)
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '20')
    const svc = getCatalogService()
    const products = await svc.listBySeller(sellerId, undefined, skip, take)
    return ok(products)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/seller/products — create product
export async function createProduct(req: NextRequest, sellerId: string) {
  try {
    const body = await req.json()
    const data = createProductSchema.parse(body)
    const svc = getCatalogService()
    const product = await svc.createProduct({
      sellerId,
      categoryId: data.categoryId,
      name: data.name,
      description: data.description,
      price: new Decimal(data.price),
      fulfillmentDays: 20,
      stockQuantity: data.stock,
      ...(data.slugOverride !== undefined ? { slugOverride: data.slugOverride } : {}),
    })
    return created(product)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/admin/products — admin list with optional status filter
export async function listProductsForAdmin(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const status = url.searchParams.getAll('status')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean) as import('@prisma/client').ProductStatus[]
    const query = url.searchParams.get('q')?.trim() ?? undefined
    const barcode = url.searchParams.get('barcode')?.trim() ?? undefined
    const sellerId = url.searchParams.get('seller')?.trim() ?? undefined
    const from = url.searchParams.get('from')?.trim()
    const to = url.searchParams.get('to')?.trim()
    const skip = Number(url.searchParams.get('skip') ?? '0')
    const take = Number(url.searchParams.get('take') ?? '30')
    const svc = getCatalogService()
    const products = await svc.listProductsForAdmin({
      ...(status.length > 0 ? { status } : {}),
      ...(query ? { query } : {}),
      ...(barcode ? { barcode } : {}),
      ...(sellerId ? { sellerId } : {}),
      ...(from ? { from: new Date(`${from}T00:00:00.000Z`) } : {}),
      ...(to ? { to: new Date(`${to}T23:59:59.999Z`) } : {}),
      skip,
      take,
    })
    return ok(products)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/products/:id/approve
export async function approveProduct(productId: string, adminActorId: string) {
  try {
    const svc = getCatalogService()
    const product = await svc.publishProduct(productId, adminActorId)
    return ok(product)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/products/:id/reject
export async function rejectProduct(req: NextRequest, productId: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const reason = typeof body.reason === 'string' ? body.reason : undefined
    const svc = getCatalogService()
    const product = await svc.rejectProduct(productId, reason)
    return ok(product)
  } catch (err) {
    return handleError(err)
  }
}

export async function updateAdminProduct(productId: string, body: { status?: 'unlisted' }) {
  try {
    const svc = getCatalogService()

    if (body.status === 'unlisted') {
      const product = await svc.adminUnlistProduct(productId)
      return ok(product)
    }

    throw new ValidationError('Gecersiz urun guncelleme istegi.')
  } catch (err) {
    return handleError(err)
  }
}

export async function deleteAdminProduct(productId: string) {
  try {
    const svc = getCatalogService()
    const result = await svc.deleteProductForAdmin(productId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/categories — root categories
export async function listCategories() {
  try {
    const svc = getCatalogService()
    const categories = await svc.listRootCategories()
    return ok(categories)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/categories/:slug
export async function getCategoryBySlug(slug: string) {
  try {
    const svc = getCatalogService()
    const category = await svc.getCategoryBySlug(slug)
    return ok(category)
  } catch (err) {
    return handleError(err)
  }
}
