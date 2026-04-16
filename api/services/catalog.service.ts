/**
 * Catalog Service — product and category operations.
 * Seller can manage only their own products.
 */
import type { PrismaClient, ProductStatus } from '@prisma/client'
import { NotFoundError, ForbiddenError, ConflictError } from '../lib/errors'
import { createProductRepository } from '../repositories/product.repository'
import { createCategoryRepository } from '../repositories/category.repository'
import { createSellerRepository } from '../repositories/seller.repository'
import { normalizeSlug } from '../domain/slug'
import { enqueueProductSync } from '../jobs/search-index-sync.job'

interface CatalogServiceDeps {
  prisma: PrismaClient
}

export function createCatalogService({ prisma }: CatalogServiceDeps) {
  const products = createProductRepository(prisma)
  const categories = createCategoryRepository(prisma)
  const sellers = createSellerRepository(prisma)

  return {
    async getProductBySlug(slug: string) {
      const product = await products.findBySlug(slug)
      if (!product || product.status !== 'published') {
        throw new NotFoundError('Product', slug)
      }
      return product
    },

    async getProductForSeller(id: string, sellerId: string) {
      const product = await products.findByIdForSeller(id, sellerId)
      if (!product) throw new NotFoundError('Product', id)
      return product
    },

    listPublished(params: {
      categoryId?: string
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      sortBy?: 'newest' | 'price-asc' | 'price-desc'
      skip?: number
      take?: number
    }) {
      return products.listPublished(params)
    },

    listBySeller(sellerId: string, status?: ProductStatus, skip?: number, take?: number) {
      return products.listBySeller({
        sellerId,
        ...(status !== undefined ? { status } : {}),
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    async createProduct(params: {
      sellerId: string
      categoryId: string
      name: string
      description: string
      price: import('@prisma/client/runtime/client').Decimal
      stockQuantity: number
      slugOverride?: string
    }) {
      const seller = await sellers.findActiveById(params.sellerId)
      if (!seller) throw new ForbiddenError('Satıcı hesabı aktif değil')

      const category = await categories.findById(params.categoryId)
      if (!category) throw new NotFoundError('Category', params.categoryId)

      const slug = params.slugOverride ?? normalizeSlug(params.name)

      // Slug uniqueness check
      const existing = await products.findBySlug(slug)
      if (existing) throw new ConflictError(`Bu slug kullanımda: ${slug}`)

      const product = await products.create({
        sellerId: params.sellerId,
        categoryId: params.categoryId,
        slug,
        name: params.name,
        description: params.description,
        price: params.price,
        stockQuantity: params.stockQuantity,
        status: 'pending_review',
      })
      // pending_review products are NOT indexed — enqueue when published
      return product
    },

    async publishProduct(id: string, adminActorId: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)
      const updated = await products.adminUpdateStatus(id, 'published')
      // Product is now public — sync to Meilisearch
      await enqueueProductSync({ operation: 'upsert', entityId: id }).catch((err) =>
        console.error('[catalog] Search sync enqueue failed (publish):', err),
      )
      return updated
    },

    async unpublishProduct(id: string, sellerId: string) {
      const updated = await products.updateStatus(id, sellerId, 'unlisted')
      // Remove from public search index
      await enqueueProductSync({ operation: 'delete', entityId: id }).catch((err) =>
        console.error('[catalog] Search sync enqueue failed (unpublish):', err),
      )
      return updated
    },

    /** Admin: list products filtered by status */
    listProductsForAdmin(params: { status?: import('@prisma/client').ProductStatus; skip?: number; take?: number }) {
      return products.listForAdmin(params)
    },

    /** Admin: reject a product with a reason */
    async rejectProduct(id: string, reason?: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)
      const updated = await prisma.product.update({
        where: { id },
        data: { status: 'rejected', rejectedAt: new Date(), ...(reason !== undefined ? { rejectionReason: reason } : {}) },
      })
      // If it was previously published, remove from search index
      if (product.status === 'published') {
        await enqueueProductSync({ operation: 'delete', entityId: id }).catch((err) =>
          console.error('[catalog] Search sync enqueue failed (reject):', err),
        )
      }
      return updated
    },

    getCategoryBySlug(slug: string) {
      return categories.findBySlug(slug)
    },

    listRootCategories() {
      return categories.listRoots()
    },

    listSubcategories(parentId: string) {
      return categories.listByParent(parentId)
    },
  }
}

export type CatalogService = ReturnType<typeof createCatalogService>
