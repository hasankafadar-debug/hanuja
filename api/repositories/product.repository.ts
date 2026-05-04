import type { Prisma, PrismaClient, ProductStatus } from '@prisma/client'

function buildPublishedOrderBy(sortBy?: 'newest' | 'price-asc' | 'price-desc' | 'name-asc') {
  if (sortBy === 'price-asc') return { price: 'asc' as const }
  if (sortBy === 'price-desc') return { price: 'desc' as const }
  if (sortBy === 'name-asc') return { name: 'asc' as const }
  return { createdAt: 'desc' as const }
}

const publishedImageInclude = {
  take: 4,
  orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }],
}

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

export function createProductRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.product.findUnique({
        where: { id },
        include: { images: true, variants: true, category: true },
      })
    },

    findBySlug(slug: string) {
      return prisma.product.findUnique({
        where: { slug },
        include: { images: true, variants: true, category: true, seller: true },
      })
    },

    /** Seller can only see their own products */
    findByIdForSeller(id: string, sellerId: string) {
      return prisma.product.findFirst({
        where: { id, sellerId },
        include: { images: true, variants: true },
      })
    },

    listBySeller(params: {
      sellerId: string
      status?: ProductStatus
      skip?: number
      take?: number
    }) {
      return prisma.product.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { images: publishedImageInclude, category: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    listPublished(params: {
      categoryId?: string
      categoryIds?: string[]
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      sellerId?: string
      sortBy?: 'newest' | 'price-asc' | 'price-desc'
      skip?: number
      take?: number
    }) {
      return prisma.product.findMany({
        where: buildPublishedWhere(params),
        include: { images: publishedImageInclude, seller: true },
        orderBy: buildPublishedOrderBy(params.sortBy),
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    countPublished(params: {
      categoryId?: string
      categoryIds?: string[]
      minPrice?: number
      maxPrice?: number
      inStockOnly?: boolean
      sellerId?: string
    }) {
      return prisma.product.count({
        where: buildPublishedWhere(params),
      })
    },

    async searchPublished(params: {
      q: string
      categorySlug?: string
      sortBy?: 'newest' | 'price-asc' | 'price-desc' | 'name-asc'
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.q.trim()
      const where: Prisma.ProductWhereInput = {
        status: 'published',
        ...(params.categorySlug
          ? {
              category: {
                is: { slug: params.categorySlug },
              },
            }
          : {}),
        OR: [
          { name: { contains: normalizedQuery, mode: 'insensitive' } },
          { description: { contains: normalizedQuery, mode: 'insensitive' } },
          {
            category: {
              is: { name: { contains: normalizedQuery, mode: 'insensitive' } },
            },
          },
          {
            seller: {
              is: { displayName: { contains: normalizedQuery, mode: 'insensitive' } },
            },
          },
        ],
      }

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { images: publishedImageInclude, seller: true, category: true },
          orderBy: buildPublishedOrderBy(params.sortBy),
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        prisma.product.count({ where }),
      ])

      return { items, total }
    },

    create(data: {
      sellerId: string
      categoryId: string
      slug: string
      name: string
      description: string
      shortDescription?: string | null
      story?: string | null
      careInstructions?: string | null
      price: import('@prisma/client/runtime/client').Decimal
      compareAtPrice?: import('@prisma/client/runtime/client').Decimal | null
      stockQuantity: number
      sku?: string | null
      barcode?: string | null
      weight?: import('@prisma/client/runtime/client').Decimal | null
      status?: ProductStatus
      moderationFindings?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
      publishedAt?: Date | null
    }) {
      return prisma.product.create({ data })
    },

    findByBarcode(barcode: string) {
      return prisma.product.findUnique({
        where: { barcode },
        include: { images: { take: 1 }, category: true },
      })
    },

    findBySkuForSeller(sellerId: string, sku: string, excludeId?: string) {
      return prisma.product.findFirst({
        where: {
          sellerId,
          sku,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, sku: true },
      })
    },

    findByBarcodeExcluding(barcode: string, excludeId?: string) {
      return prisma.product.findFirst({
        where: {
          barcode,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true, barcode: true, sellerId: true },
      })
    },

    async updateStatus(id: string, sellerId: string, status: ProductStatus) {
      const product = await prisma.product.findFirst({ where: { id, sellerId } })
      if (!product) return null

      return prisma.product.update({ where: { id }, data: { status } })
    },

    /** Admin can update status without sellerId constraint */
    adminUpdateStatus(id: string, status: ProductStatus) {
      return prisma.product.update({ where: { id }, data: { status } })
    },

    /** Admin list — filter by status, paginated */
    async listForAdmin(params: {
      status?: ProductStatus[]
      sellerId?: string
      query?: string
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const where: Prisma.ProductWhereInput = {
        ...(params.status !== undefined && params.status.length > 0 ? { status: { in: params.status } } : {}),
        ...(params.sellerId !== undefined ? { sellerId: params.sellerId } : {}),
        ...(params.from !== undefined || params.to !== undefined
          ? {
              createdAt: {
                ...(params.from !== undefined ? { gte: params.from } : {}),
                ...(params.to !== undefined ? { lte: params.to } : {}),
              },
            }
          : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { name: { contains: normalizedQuery, mode: 'insensitive' } },
                { description: { contains: normalizedQuery, mode: 'insensitive' } },
                { seller: { is: { displayName: { contains: normalizedQuery, mode: 'insensitive' } } } },
                { category: { is: { name: { contains: normalizedQuery, mode: 'insensitive' } } } },
                { sku: { contains: normalizedQuery, mode: 'insensitive' } },
                { barcode: { contains: normalizedQuery, mode: 'insensitive' } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            seller: { select: { id: true, displayName: true } },
            category: { select: { name: true } },
            images: { take: 1 },
          },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 30,
        }),
        prisma.product.count({ where }),
      ])

      return { rows, total }
    },

    decrementStock(id: string, quantity: number, tx: PrismaClient) {
      return tx.product.update({
        where: { id },
        data: { stockQuantity: { decrement: quantity } },
      })
    },
  }
}

export type ProductRepository = ReturnType<typeof createProductRepository>
