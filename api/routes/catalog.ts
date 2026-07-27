/**
 * Catalog route handlers — products and categories.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, created, handleError } from '../lib/response'
import { createCatalogService } from '../services/catalog.service'
import { createPrismaForRoute } from '../lib/prisma'
import { Decimal } from '@prisma/client/runtime/client'
import { ValidationError } from '../lib/errors'
import { requireModelCode } from '../domain/model-code'

function getCatalogService() {
  return createCatalogService({ prisma: createPrismaForRoute() })
}

// Storefront server rendering may use modelCode to join siblings, but the
// seller's internal grouping value must never be part of the public JSON API.
function withoutModelCode<T extends { modelCode?: unknown }>(product: T) {
  const { modelCode: _modelCode, ...publicProduct } = product
  return publicProduct
}

const createProductSchema = z.object({
  categoryId: z.string().cuid(),
  name: z.string().min(3).max(200),
  description: z.string().min(10),
  price: z.number().positive(),
  stock: z.number().int().min(0),
  modelCode: z.string().min(1).max(120),
  slugOverride: z.string().optional(),
})

// GET /api/products/:slug — storefront product detail
export async function getProductBySlug(slug: string) {
  try {
    const svc = getCatalogService()
    const product = await svc.getProductBySlug(slug)
    return ok(withoutModelCode(product))
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
    const products = await svc.listPublished({
      ...(categoryId !== undefined ? { categoryId } : {}),
      skip,
      take,
    })
    return ok(products.map(withoutModelCode))
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
    const prisma = createPrismaForRoute()
    const product = await prisma.$transaction(async (tx) => {
      const svc = createCatalogService({
        prisma: tx as unknown as import('@prisma/client').PrismaClient,
      })
      return svc.createProduct({
        sellerId,
        categoryId: data.categoryId,
        name: data.name,
        description: data.description,
        price: new Decimal(data.price),
        fulfillmentDays: 20,
        stockQuantity: data.stock,
        modelCode: requireModelCode(data.modelCode),
        ...(data.slugOverride !== undefined ? { slugOverride: data.slugOverride } : {}),
      })
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
    const status = url.searchParams
      .getAll('status')
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

/**
 * Upper bound on ids accepted by one bulk approve request. Matches the admin
 * product list's maximum page size, so "select all on this page" always fits.
 */
const BULK_APPROVE_MAX_IDS = 100

const bulkApproveSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(BULK_APPROVE_MAX_IDS),
})

// POST /api/admin/products/bulk-approve
export async function bulkApproveProducts(req: NextRequest, adminActorId: string) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = bulkApproveSchema.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError(
        `Gecersiz toplu onay istegi. En az 1, en fazla ${BULK_APPROVE_MAX_IDS} urun secilebilir.`,
      )
    }

    const svc = getCatalogService()
    const result = await svc.bulkPublishProducts(parsed.data.ids, adminActorId)
    return NextResponse.json(result)
  } catch (err) {
    return handleError(err)
  }
}

// POST /api/admin/products/:id/reject
export async function rejectProduct(req: NextRequest, productId: string) {
  try {
    const body = (await req.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason : undefined
    const svc = getCatalogService()
    const product = await svc.rejectProduct(productId, reason)
    return ok(product)
  } catch (err) {
    return handleError(err)
  }
}

export async function updateAdminProduct(productId: string, body: { status?: 'unlisted' }, adminActorId: string) {
  try {
    const svc = getCatalogService()

    if (body.status === 'unlisted') {
      const product = await svc.adminUnlistProduct(productId, adminActorId)
      return ok(product)
    }

    throw new ValidationError('Gecersiz urun guncelleme istegi.')
  } catch (err) {
    return handleError(err)
  }
}

export async function deleteAdminProduct(productId: string, adminActorId: string) {
  try {
    const svc = getCatalogService()
    const result = await svc.deleteProductForAdmin(productId, adminActorId)
    return ok(result)
  } catch (err) {
    return handleError(err)
  }
}

// GET /api/categories — customer-visible root categories.
// Public storefront endpoint: empty categories (no published product in the
// subtree) are hidden here. Seller/admin flows use listAllCategories instead.
export async function listCategories() {
  try {
    const svc = getCatalogService()
    const categories = await svc.listCustomerVisibleRootCategories()
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
