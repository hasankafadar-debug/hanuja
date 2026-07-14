/**
 * Catalog Service - product and category operations.
 * Seller can manage only their own products.
 */
import { Prisma } from '@prisma/client'
import type { OrderStatus, PrismaClient, ProductStatus } from '@prisma/client'
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../lib/errors'
import { createProductRepository } from '../repositories/product.repository'
import { createCategoryRepository } from '../repositories/category.repository'
import { createSellerRepository } from '../repositories/seller.repository'
import { createDiscountService } from './discount.service'
import type { EffectivePriceResult } from './discount.service'
import { createContentScannerService } from './content-scanner.service'
import { buildSlugWithSuffix, isValidSlug, normalizeSlug } from '../domain/slug'
import { computeCustomerVisibleCategoryIds } from '../domain/category-visibility'
import {
  selectCampaignDiscountShowcase,
  selectWeeklyFavoriteShowcase,
} from '../domain/homepage-showcase'
import { enqueueCategorySync, enqueueProductSync } from '../jobs/search-index-sync.job'

interface CatalogServiceDeps {
  prisma: PrismaClient
}

type DecimalLike = import('@prisma/client/runtime/client').Decimal
type PublishedCatalogSort = 'newest' | 'price-asc' | 'price-desc' | 'favorited'

const BEST_SELLER_ORDER_STATUSES: OrderStatus[] = [
  'seller_queue_ready',
  'seller_reviewing',
  'seller_accepted',
  'preparing',
  'awaiting_shipment',
  'shipped',
  'delivered',
  'delivery_confirmation_pending',
  'delivery_confirmed',
]

export function createCatalogService({ prisma }: CatalogServiceDeps) {
  const products = createProductRepository(prisma)
  const categories = createCategoryRepository(prisma)
  const sellers = createSellerRepository(prisma)
  const discounts = createDiscountService({ prisma })
  const contentScanner = createContentScannerService()

  function buildPublishedWhere(params: {
    categoryId?: string
    categoryIds?: string[]
    minPrice?: number
    maxPrice?: number
    inStockOnly?: boolean
    sellerId?: string
  }): Prisma.ProductWhereInput {
    const categoryFilter =
      params.categoryIds && params.categoryIds.length > 0
        ? { categoryId: { in: params.categoryIds } }
        : params.categoryId !== undefined
          ? { categoryId: params.categoryId }
          : {}

    return {
      status: 'published',
      ...categoryFilter,
      ...(params.sellerId !== undefined ? { sellerId: params.sellerId } : {}),
      ...(params.minPrice !== undefined || params.maxPrice !== undefined
        ? {
            price: {
              ...(params.minPrice !== undefined ? { gte: params.minPrice } : {}),
              ...(params.maxPrice !== undefined ? { lte: params.maxPrice } : {}),
            },
          }
        : {}),
      ...(params.inStockOnly === true ? { stockQuantity: { gt: 0 } } : {}),
    }
  }

  async function loadCustomerVisibleCategoryData() {
    const [all, counts] = await Promise.all([
      categories.findAll(),
      products.countPublishedGroupedByCategory(),
    ])
    const countByCategoryId = new Map<string, number>()
    for (const row of counts) {
      if (row.categoryId !== null) countByCategoryId.set(row.categoryId, row._count._all)
    }
    const visibleIds = computeCustomerVisibleCategoryIds(all, countByCategoryId)
    return { all, visibleIds }
  }

  async function loadPublishedCandidates(params: {
    categoryId?: string
    categoryIds?: string[]
    minPrice?: number
    maxPrice?: number
    inStockOnly?: boolean
    sellerId?: string
  }) {
    return prisma.product.findMany({
      where: buildPublishedWhere(params),
      include: {
        images: {
          take: 4,
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
        seller: true,
        category: true,
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async function enrichPublishedProducts<
    T extends {
      id: string
      sellerId: string
      categoryId: string | null
      price: DecimalLike
      compareAtPrice: DecimalLike | null
      publishedAt?: Date | null
      createdAt: Date
    },
  >(items: T[]) {
    const pricedItems = await applyEffectivePricingToProducts(items)
    const productIds = pricedItems.map((item) => item.id)

    const [favoriteCounts, salesCounts] = productIds.length
      ? await Promise.all([
          prisma.favoriteProduct.groupBy({
            by: ['productId'],
            where: { productId: { in: productIds } },
            _count: { productId: true },
          }),
          prisma.orderLine.groupBy({
            by: ['productId'],
            where: {
              productId: { in: productIds },
              order: {
                status: { in: BEST_SELLER_ORDER_STATUSES },
              },
            },
            _sum: { quantity: true },
          }),
        ])
      : [[], []]

    const favoriteCountMap = new Map(
      favoriteCounts.map((row) => [row.productId, row._count.productId]),
    )
    const salesCountMap = new Map(
      salesCounts.map((row) => [row.productId, row._sum.quantity ?? 0]),
    )

    return pricedItems.map((item) => {
      const currentPrice = item.price.toNumber()
      const originalPrice = item.compareAtPrice?.toNumber() ?? null

      return {
        ...item,
        favoriteCount: favoriteCountMap.get(item.id) ?? 0,
        salesCount: salesCountMap.get(item.id) ?? 0,
        isOnSale: originalPrice !== null && originalPrice > currentPrice,
        rankingDate: item.publishedAt ?? item.createdAt,
      }
    })
  }

  function sortCuratedProducts<
    T extends {
      price: DecimalLike
      favoriteCount: number
      salesCount: number
      isOnSale: boolean
      rankingDate: Date
      name: string
    },
  >(items: T[], sortBy: PublishedCatalogSort) {
    return [...items].sort((left, right) => {
      if (sortBy === 'price-asc') return left.price.toNumber() - right.price.toNumber()
      if (sortBy === 'price-desc') return right.price.toNumber() - left.price.toNumber()
      if (sortBy === 'favorited') {
        return (
          right.favoriteCount - left.favoriteCount ||
          Number(right.isOnSale) - Number(left.isOnSale) ||
          right.rankingDate.getTime() - left.rankingDate.getTime() ||
          left.name.localeCompare(right.name, 'tr')
        )
      }

      return (
        Number(right.isOnSale) - Number(left.isOnSale) ||
        right.rankingDate.getTime() - left.rankingDate.getTime() ||
        left.name.localeCompare(right.name, 'tr')
      )
    })
  }

  async function applyEffectivePricingToProduct<
    T extends {
      id: string
      sellerId: string
      categoryId: string | null
      price: DecimalLike
      compareAtPrice: DecimalLike | null
    },
  >(product: T): Promise<T> {
    const pricing = await discounts.resolveEffectivePrice(product, product.sellerId)

    return {
      ...product,
      price: pricing.effectivePrice,
      compareAtPrice: pricing.discountSource ? pricing.originalPrice : product.compareAtPrice,
    }
  }

  async function applyEffectivePricingToProducts<
    T extends {
      id: string
      sellerId: string
      categoryId: string | null
      price: DecimalLike
      compareAtPrice: DecimalLike | null
    },
  >(items: T[]): Promise<Array<T & { discountSource: EffectivePriceResult['discountSource'] }>> {
    const pricingMap = await discounts.resolveEffectivePrices(items)

    return items.map((item) => {
      const pricing = pricingMap.get(item.id)
      if (!pricing) return { ...item, discountSource: null }

      return {
        ...item,
        price: pricing.effectivePrice,
        compareAtPrice: pricing.discountSource ? pricing.originalPrice : item.compareAtPrice,
        discountSource: pricing.discountSource,
      }
    })
  }

  async function ensureUniqueIdentifiers(params: {
    barcode?: string | null
    excludeProductId?: string
  }) {
    const normalizedBarcode = params.barcode?.trim() || null

    if (normalizedBarcode) {
      const existingBarcode = await products.findByBarcodeExcluding(
        normalizedBarcode,
        params.excludeProductId,
      )
      if (existingBarcode) {
        throw new ConflictError('Bu barkod başka bir ürüne kayıtlı')
      }
    }
  }

  async function resolveUniqueProductSlug(input: string) {
    const baseSlug = normalizeSlug(input) || 'urun'

    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const candidate = buildSlugWithSuffix(baseSlug, suffix)
      const existing = await products.findBySlug(candidate)
      if (!existing) return candidate
    }

    throw new ConflictError('Urun icin benzersiz slug olusturulamadi.')
  }

  function getModerationDecision(input: {
    name: string
    description?: string | null
    shortDescription?: string | null
    story?: string | null
    careInstructions?: string | null
  }): {
    status: ProductStatus
    moderationFindings: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
  } {
    const scan = contentScanner.scanProductContent(input)
    if (scan.flagged) {
      return {
        status: 'pending_review',
        moderationFindings: scan.findings as unknown as Prisma.InputJsonArray,
      }
    }

    return {
      status: process.env['AUTO_APPROVE_CLEAN_PRODUCTS'] === 'true' ? 'published' : 'pending_review',
      moderationFindings: Prisma.JsonNull,
    }
  }

  async function syncProductVisibility(productId: string, previousStatus: ProductStatus, nextStatus: ProductStatus) {
    if (nextStatus === 'published') {
      await enqueueProductSync({ operation: 'upsert', entityId: productId }).catch((err) =>
        console.error('[catalog] Search sync enqueue failed (upsert):', err),
      )
      return
    }

    if (previousStatus === 'published') {
      await enqueueProductSync({ operation: 'delete', entityId: productId }).catch((err) =>
        console.error('[catalog] Search sync enqueue failed (delete):', err),
      )
    }
  }

  return {
    async getProductBySlug(slug: string) {
      const product = await products.findBySlug(slug)
      if (!product || product.status !== 'published') {
        throw new NotFoundError('Product', slug)
      }
      return applyEffectivePricingToProduct(product)
    },

    async getProductForSeller(id: string, sellerId: string) {
      const product = await products.findByIdForSeller(id, sellerId)
      if (!product) throw new NotFoundError('Product', id)
      return product
    },

    async listPublished(params: {
      categoryId?: string
      categoryIds?: string[]
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      onSaleOnly?: boolean
      sellerId?: string
      sortBy?: 'newest' | 'price-asc' | 'price-desc'
      skip?: number
      take?: number
    }) {
      const publishedProducts = await products.listPublished(params)
      const pricedProducts = await applyEffectivePricingToProducts(publishedProducts)
      // Bu metodun sonucu public JSON route'unda (GET /api/products) ham döner;
      // discountSource internal bir zenginleştirme alanıdır (kural adı/id içerir)
      // ve public payload'a sızmaması için burada çıkarılır.
      return pricedProducts.map(({ discountSource: _discountSource, ...item }) => item)
    },

    async listPublishedCurated(params: {
      categoryId?: string
      categoryIds?: string[]
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      onSaleOnly?: boolean
      sellerId?: string
      sortBy?: PublishedCatalogSort
      skip?: number
      take?: number
    }) {
      const candidates = await loadPublishedCandidates(params)
      const enriched = await enrichPublishedProducts(candidates)
      const filtered =
        params.onSaleOnly === true ? enriched.filter((item) => item.isOnSale) : enriched
      const sorted = sortCuratedProducts(filtered, params.sortBy ?? 'newest')
      const start = params.skip ?? 0
      const end = start + (params.take ?? 20)
      return {
        items: sorted.slice(start, end),
        total: sorted.length,
      }
    },

    async listPublishedWithCursor(params: {
      sellerId?: string
      categoryId?: string
      categoryIds?: string[]
      cursor?: string
      take?: number
    }) {
      const result = await products.listPublishedWithCursor(params)
      const pricedItems = await applyEffectivePricingToProducts(result.items)
      return { ...result, items: pricedItems }
    },

    countPublished(params: {
      categoryId?: string
      categoryIds?: string[]
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      onSaleOnly?: boolean
      sellerId?: string
    }) {
      return products.countPublished(params)
    },

    listBySeller(sellerId: string, status?: ProductStatus, skip?: number, take?: number) {
      return products.listBySeller({
        sellerId,
        ...(status !== undefined ? { status } : {}),
        ...(skip !== undefined ? { skip } : {}),
        ...(take !== undefined ? { take } : {}),
      })
    },

    async searchPublished(params: {
      q: string
      categorySlug?: string
      sortBy?: 'newest' | 'price-asc' | 'price-desc' | 'name-asc'
      skip?: number
      take?: number
    }) {
      const result = await products.searchPublished(params)
      return {
        ...result,
        items: await applyEffectivePricingToProducts(result.items),
      }
    },

    async createProduct(params: {
      sellerId: string
      categoryId: string
      name: string
      description: string
      shortDescription?: string | null
      story?: string | null
      careInstructions?: string | null
      price: DecimalLike
      compareAtPrice?: DecimalLike | null
      fulfillmentDays: number
      stockQuantity: number
      sku?: string | null
      barcode?: string | null
      weight?: DecimalLike | null
      slugOverride?: string
    }) {
      const seller = await sellers.findActiveById(params.sellerId)
      if (!seller) throw new ForbiddenError('Satıcı hesabı aktif değil')

      const category = await categories.findById(params.categoryId)
      if (!category) throw new NotFoundError('Category', params.categoryId)

      if (
        params.compareAtPrice &&
        params.compareAtPrice.toNumber() <= params.price.toNumber()
      ) {
        throw new ValidationError('Liste fiyatı satış fiyatından büyük olmalıdır.')
      }

      if (!Number.isInteger(params.fulfillmentDays) || params.fulfillmentDays < 1) {
        throw new ValidationError('Sevk suresi en az 1 is gunu olmalidir.')
      }

      const slug = await resolveUniqueProductSlug(params.slugOverride ?? params.name)

      await ensureUniqueIdentifiers({
        barcode: params.barcode ?? null,
      })

      const moderation = getModerationDecision({
        name: params.name,
        description: params.description,
        shortDescription: params.shortDescription ?? null,
        story: params.story ?? null,
        careInstructions: params.careInstructions ?? null,
      })

      const product = await products.create({
        sellerId: params.sellerId,
        categoryId: params.categoryId,
        slug,
        name: params.name,
        description: params.description,
        shortDescription: params.shortDescription ?? null,
        story: params.story ?? null,
        careInstructions: params.careInstructions ?? null,
        price: params.price,
        compareAtPrice: params.compareAtPrice ?? null,
        fulfillmentDays: params.fulfillmentDays,
        stockQuantity: params.stockQuantity,
        sku: params.sku ?? null,
        barcode: params.barcode ?? null,
        weight: params.weight ?? null,
        status: moderation.status,
        moderationFindings: moderation.moderationFindings,
        publishedAt: moderation.status === 'published' ? new Date() : null,
      })

      await syncProductVisibility(product.id, 'draft', product.status)

      return product
    },

    async updateProductForSeller(params: {
      productId: string
      sellerId: string
      name?: string
      categoryId?: string | null
      description?: string | null
      shortDescription?: string | null
      story?: string | null
      careInstructions?: string | null
      price?: DecimalLike
      compareAtPrice?: DecimalLike | null
      fulfillmentDays?: number
      stockQuantity?: number
      sku?: string | null
      barcode?: string | null
      weight?: DecimalLike | null
    }) {
      const seller = await sellers.findActiveById(params.sellerId)
      if (!seller) throw new ForbiddenError('Satıcı hesabı aktif değil')

      const product = await products.findByIdForSeller(params.productId, params.sellerId)
      if (!product) throw new NotFoundError('Product', params.productId)

      const nextCategoryId = params.categoryId === undefined ? product.categoryId : params.categoryId
      if (nextCategoryId) {
        const category = await categories.findById(nextCategoryId)
        if (!category) throw new NotFoundError('Category', nextCategoryId)
      }

      const nextPrice = params.price ?? product.price
      const nextCompareAtPrice =
        params.compareAtPrice === undefined ? product.compareAtPrice : params.compareAtPrice

      if (
        nextCompareAtPrice &&
        nextCompareAtPrice.toNumber() <= nextPrice.toNumber()
      ) {
        throw new ValidationError('Liste fiyatı satış fiyatından büyük olmalıdır.')
      }

      if (
        params.fulfillmentDays !== undefined &&
        (!Number.isInteger(params.fulfillmentDays) || params.fulfillmentDays < 1)
      ) {
        throw new ValidationError('Sevk suresi en az 1 is gunu olmalidir.')
      }

      const nextBarcode = params.barcode === undefined ? product.barcode : params.barcode

      await ensureUniqueIdentifiers({
        barcode: nextBarcode ?? null,
        excludeProductId: params.productId,
      })
      const contentFieldsChanged =
        params.name !== undefined ||
        params.description !== undefined ||
        params.shortDescription !== undefined ||
        params.story !== undefined ||
        params.careInstructions !== undefined
      const moderation = contentFieldsChanged
        ? getModerationDecision({
            name: params.name ?? product.name,
            description: params.description === undefined ? product.description : params.description,
            shortDescription:
              params.shortDescription === undefined ? product.shortDescription : params.shortDescription,
            story: params.story === undefined ? product.story : params.story,
            careInstructions:
              params.careInstructions === undefined ? product.careInstructions : params.careInstructions,
          })
        : null
      const nextStatus =
        moderation === null
          ? product.status
          : product.status === 'published'
            ? 'published'
            : moderation.status
      const nextPublishedAt =
        moderation === null
          ? product.publishedAt
          : nextStatus === 'published'
            ? product.publishedAt ?? new Date()
            : null

      const updated = await prisma.product.update({
        where: { id: params.productId },
        data: {
          ...(params.name !== undefined ? { name: params.name } : {}),
          ...(params.categoryId !== undefined ? { categoryId: params.categoryId } : {}),
          ...(params.description !== undefined ? { description: params.description } : {}),
          ...(params.shortDescription !== undefined ? { shortDescription: params.shortDescription } : {}),
          ...(params.story !== undefined ? { story: params.story } : {}),
          ...(params.careInstructions !== undefined ? { careInstructions: params.careInstructions } : {}),
          ...(params.price !== undefined ? { price: params.price } : {}),
          ...(params.compareAtPrice !== undefined ? { compareAtPrice: params.compareAtPrice } : {}),
          ...(params.fulfillmentDays !== undefined ? { fulfillmentDays: params.fulfillmentDays } : {}),
          ...(params.stockQuantity !== undefined ? { stockQuantity: params.stockQuantity } : {}),
          ...(params.sku !== undefined ? { sku: params.sku } : {}),
          ...(params.barcode !== undefined ? { barcode: params.barcode } : {}),
          ...(params.weight !== undefined ? { weight: params.weight } : {}),
          ...(moderation
            ? {
                status: nextStatus,
                moderationFindings: moderation.moderationFindings,
                rejectionReason: null,
                rejectedAt: null,
                publishedAt: nextPublishedAt,
              }
            : {}),
        },
      })

      if (moderation) {
        await syncProductVisibility(updated.id, product.status, updated.status)
      }

      return updated
    },

    async publishProduct(id: string, _adminActorId: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)

      const updated = await prisma.product.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: product.publishedAt ?? new Date(),
          rejectedAt: null,
          rejectionReason: null,
        },
      })

      await syncProductVisibility(id, product.status, 'published')

      return updated
    },

    async unpublishProduct(id: string, sellerId: string) {
      const existing = await products.findByIdForSeller(id, sellerId)
      if (!existing) return null

      const updated = await prisma.product.update({
        where: { id },
        data: {
          status: 'unlisted',
          publishedAt: null,
        },
      })

      await syncProductVisibility(id, existing.status, 'unlisted')

      return updated
    },

    async adminUnlistProduct(id: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)

      const updated = await prisma.product.update({
        where: { id },
        data: {
          status: 'unlisted',
          publishedAt: null,
        },
      })

      await syncProductVisibility(id, product.status, 'unlisted')

      return updated
    },

    listProductsForAdmin(params: Parameters<typeof products.listForAdmin>[0]) {
      return products.listForAdmin(params)
    },

    async rejectProduct(id: string, reason?: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)

      const updated = await prisma.product.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectedAt: new Date(),
          publishedAt: null,
          ...(reason !== undefined ? { rejectionReason: reason } : {}),
        },
      })

      await syncProductVisibility(id, product.status, 'rejected')

      return updated
    },

    async deleteProductForAdmin(id: string) {
      const product = await products.findById(id)
      if (!product) throw new NotFoundError('Product', id)

      const linkedOrderLineCount = await prisma.orderLine.count({ where: { productId: id } })
      if (linkedOrderLineCount > 0) {
        throw new ValidationError('Siparis gecmisi olan urun silinemez. Once yayindan kaldirin.')
      }

      await prisma.product.delete({ where: { id } })
      await syncProductVisibility(id, product.status, 'unlisted')

      return { id }
    },

    getSellersByCategory(categoryIds: string[]) {
      return products.getSellersByCategory(categoryIds)
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

    listAllCategories() {
      return categories.findAll()
    },

    // ── Customer-visible categories ─────────────────────────────────────────
    // Launch policy: customers only see categories whose subtree contains at
    // least one published product. Seller/admin flows keep listAllCategories.

    async getCustomerVisibleCategoryIdSet() {
      const { visibleIds } = await loadCustomerVisibleCategoryData()
      return visibleIds
    },

    async listCustomerVisibleCategories() {
      const { all, visibleIds } = await loadCustomerVisibleCategoryData()
      return all.filter((category) => visibleIds.has(category.id))
    },

    async listCustomerVisibleRootCategories() {
      const { all, visibleIds } = await loadCustomerVisibleCategoryData()
      return all
        .filter((category) => category.parentId === null && visibleIds.has(category.id))
        .sort((left, right) => left.sortOrder - right.sortOrder)
    },

    async updateCategoryForAdmin(params: {
      categoryId: string
      name?: string
      slug?: string
      description?: string | null
      imageUrl?: string | null
      sortOrder?: number
      isActive?: boolean
      taxRate?: number | null
    }) {
      const existing = await categories.findById(params.categoryId)
      if (!existing) throw new NotFoundError('Category', params.categoryId)

      const nextName = params.name?.trim() ?? existing.name
      if (!nextName) {
        throw new ValidationError('Kategori adı boş olamaz.')
      }

      const nextSlugInput = params.slug?.trim()
      const nextSlug = nextSlugInput !== undefined ? normalizeSlug(nextSlugInput) : existing.slug
      if (!isValidSlug(nextSlug)) {
        throw new ValidationError('Kategori slug alanı geçersiz.')
      }

      if (nextSlug !== existing.slug) {
        const slugTaken = await categories.findBySlug(nextSlug)
        if (slugTaken && slugTaken.id !== existing.id) {
          throw new ConflictError(`Bu slug kullanımda: ${nextSlug}`)
        }
      }

      const updated = await categories.update(params.categoryId, {
        ...(params.name !== undefined ? { name: nextName } : {}),
        ...(params.slug !== undefined ? { slug: nextSlug } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.imageUrl !== undefined ? { imageUrl: params.imageUrl } : {}),
        ...(params.sortOrder !== undefined ? { sortOrder: params.sortOrder } : {}),
        ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(params.taxRate !== undefined ? { taxRate: params.taxRate } : {}),
      })

      await enqueueCategorySync({ entityId: params.categoryId }).catch((err) =>
        console.error('[catalog] Search sync enqueue failed (category):', err),
      )

      return updated
    },

    async updateCategoryTaxGroupForAdmin(params: {
      categoryIds: string[]
      taxRate: number | null
      actorId: string
    }) {
      const categoryIds = [...new Set(params.categoryIds.map((id) => id.trim()).filter(Boolean))]
      if (categoryIds.length === 0) {
        throw new ValidationError('En az bir kategori seçilmelidir.')
      }

      const existing = await prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true, name: true, taxRate: true },
      })

      if (existing.length !== categoryIds.length) {
        const existingIds = new Set(existing.map((category) => category.id))
        const missingId = categoryIds.find((id) => !existingIds.has(id))
        throw new NotFoundError('Category', missingId ?? categoryIds[0])
      }

      const existingMap = new Map(existing.map((category) => [category.id, category]))

      const updated = await prisma.$transaction(async (tx) => {
        const updatedCategories = []

        for (const categoryId of categoryIds) {
          const previous = existingMap.get(categoryId)
          const next = await tx.category.update({
            where: { id: categoryId },
            data: { taxRate: params.taxRate },
          })
          updatedCategories.push(next)

          await tx.adminAuditLog.create({
            data: {
              actorId: params.actorId,
              actionType: 'category_tax_rate_changed',
              targetType: 'category',
              targetId: categoryId,
              previousData: {
                taxRate: previous?.taxRate?.toString() ?? null,
                name: previous?.name ?? null,
              } as never,
              newData: {
                taxRate: next.taxRate?.toString() ?? null,
                name: next.name,
                groupSize: categoryIds.length,
              } as never,
            },
          })
        }

        return updatedCategories
      })

      for (const categoryId of categoryIds) {
        await enqueueCategorySync({ entityId: categoryId }).catch((err) =>
          console.error('[catalog] Search sync enqueue failed (category-group):', err),
        )
      }

      return updated
    },

    async bulkUpdatePriceStock(params: {
      sellerId: string
      rows: Array<{ identifier: string; newPrice?: number; newStock?: number }>
    }) {
      const results: Array<{
        identifier: string
        status: 'matched' | 'not_found' | 'invalid' | 'noop' | 'updated'
        productId?: string
        productName?: string
        oldPrice?: number
        newPrice?: number
        oldStock?: number
        newStock?: number
        message?: string
      }> = []

      for (const row of params.rows) {
        const identifier = row.identifier.trim()
        if (!identifier) {
          results.push({ identifier, status: 'invalid', message: 'Kimlik alanı boş olamaz' })
          continue
        }

        const product = await prisma.product.findFirst({
          where: {
            sellerId: params.sellerId,
            barcode: identifier,
          },
          select: {
            id: true,
            name: true,
            price: true,
            stockQuantity: true,
          },
        })

        if (!product) {
          results.push({ identifier, status: 'not_found', message: 'Ürün bulunamadı' })
          continue
        }

        const oldPrice = product.price.toNumber()
        const oldStock = product.stockQuantity
        const nextPrice = row.newPrice ?? oldPrice
        const nextStock = row.newStock ?? oldStock

        if (nextPrice === oldPrice && nextStock === oldStock) {
          results.push({
            identifier,
            status: 'noop',
            productId: product.id,
            productName: product.name,
            oldPrice,
            newPrice: nextPrice,
            oldStock,
            newStock: nextStock,
            message: 'Aynı değerler olduğu için atlandı',
          })
          continue
        }

        await prisma.product.update({
          where: { id: product.id },
          data: {
            ...(row.newPrice !== undefined ? { price: row.newPrice } : {}),
            ...(row.newStock !== undefined ? { stockQuantity: row.newStock } : {}),
          },
        })

        results.push({
          identifier,
          status: 'updated',
          productId: product.id,
          productName: product.name,
          oldPrice,
          newPrice: nextPrice,
          oldStock,
          newStock: nextStock,
        })
      }

      return results
    },

    /**
     * Returns every leaf category under the given parent slug.
     * Leaf means active category without children.
     */
    async getLeafDescendants(
      parentSlug: string,
    ): Promise<Array<{ id: string; slug: string; name: string }>> {
      const all = await categories.findAll()
      const byId = new Map(all.map((category) => [category.id, category]))
      const childrenOf = new Map<string | null, typeof all>()

      for (const category of all) {
        const key = category.parentId ?? null
        const list = childrenOf.get(key) ?? []
        list.push(category)
        childrenOf.set(key, list)
      }

      const root = all.find((category) => category.slug === parentSlug)
      if (!root) return []

      const leaves: Array<{ id: string; slug: string; name: string }> = []

      function dfs(nodeId: string) {
        const children = childrenOf.get(nodeId) ?? []
        if (children.length === 0) {
          const node = byId.get(nodeId)
          if (node) leaves.push({ id: node.id, slug: node.slug, name: node.name })
          return
        }
        for (const child of children) dfs(child.id)
      }

      dfs(root.id)
      return leaves
    },

    async getHomepageFeaturedProducts(
      groups: Array<{ key: string; categoryIds: string[] }>,
    ) {
      const picks: Array<Awaited<ReturnType<typeof enrichPublishedProducts>>[number]> = []
      const pickedIds = new Set<string>()

      for (const group of groups) {
        const candidates = await loadPublishedCandidates({ categoryIds: group.categoryIds })
        const enriched = await enrichPublishedProducts(candidates)
        const best = [...enriched]
          .filter((item) => !pickedIds.has(item.id))
          .sort((left, right) => {
          return (
            right.salesCount - left.salesCount ||
            Number(right.isOnSale) - Number(left.isOnSale) ||
            right.rankingDate.getTime() - left.rankingDate.getTime() ||
            left.name.localeCompare(right.name, 'tr')
          )
          })[0]

        if (best) {
          picks.push(best)
          pickedIds.add(best.id)
        }
      }

      return picks
    },

    /**
     * "Haftanın Favorileri" — most-favorited products of the last 7 calendar days.
     * One product per homepage featured group first, then filled to `limit`
     * (see selectWeeklyFavoriteShowcase for the fill rules).
     *
     * Not: tüm yayınlanmış katalog üzerinde tek tam-tarama yapar (mevcut
     * getHomepageFeaturedProducts ile benzer maliyet profili); anasayfa
     * revalidate=300 (5 dk ISR) olduğundan kabul edilebilir.
     */
    async getWeeklyFavoriteShowcase(
      groups: Array<{ key: string; categoryIds: string[] }>,
      limit = 20,
    ) {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const [candidates, weeklyFavoriteRows] = await Promise.all([
        loadPublishedCandidates({}),
        prisma.favoriteProduct.groupBy({
          by: ['productId'],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { productId: true },
        }),
      ])

      const enriched = await enrichPublishedProducts(candidates)
      const weeklyFavoriteCountByProductId = new Map(
        weeklyFavoriteRows.map((row) => [row.productId, row._count.productId]),
      )

      return selectWeeklyFavoriteShowcase(enriched, weeklyFavoriteCountByProductId, groups, limit)
    },

    /**
     * "Özel Kampanyalı Ürünler" — active DiscountRule campaigns started within
     * the last 3 calendar months, ranked by highest discount percent against the
     * real sale price. No filler when fewer qualify (intentional).
     */
    async getCampaignDiscountProducts(limit = 25) {
      const cutoffDate = new Date()
      cutoffDate.setMonth(cutoffDate.getMonth() - 3)

      const candidates = await loadPublishedCandidates({})
      const enriched = await enrichPublishedProducts(candidates)

      return selectCampaignDiscountShowcase(enriched, cutoffDate, limit)
    },
  }
}

export type CatalogService = ReturnType<typeof createCatalogService>
