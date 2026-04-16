import type { PrismaClient, ProductStatus } from '@prisma/client'

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
      return prisma.product.findUnique({
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
        include: { images: { take: 1 } },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
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
      const orderBy =
        params.sortBy === 'price-asc'
          ? { price: 'asc' as const }
          : params.sortBy === 'price-desc'
          ? { price: 'desc' as const }
          : { createdAt: 'desc' as const }

      return prisma.product.findMany({
        where: {
          status: 'published',
          ...(params.categoryId !== undefined ? { categoryId: params.categoryId } : {}),
          ...(params.minPrice !== undefined || params.maxPrice !== undefined
            ? {
                price: {
                  ...(params.minPrice !== undefined ? { gte: params.minPrice } : {}),
                  ...(params.maxPrice !== undefined ? { lte: params.maxPrice } : {}),
                },
              }
            : {}),
          ...(params.inStockOnly === true ? { stockQuantity: { gt: 0 } } : {}),
        },
        include: { images: { take: 1 }, seller: true },
        orderBy,
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    create(data: {
      sellerId: string
      categoryId: string
      slug: string
      name: string
      description: string
      price: import('@prisma/client/runtime/client').Decimal
      stockQuantity: number
      status?: ProductStatus
    }) {
      return prisma.product.create({ data })
    },

    updateStatus(id: string, sellerId: string, status: ProductStatus) {
      return prisma.product.update({ where: { id, sellerId }, data: { status } })
    },

    /** Admin can update status without sellerId constraint */
    adminUpdateStatus(id: string, status: ProductStatus) {
      return prisma.product.update({ where: { id }, data: { status } })
    },

    /** Admin list — filter by status, paginated */
    listForAdmin(params: { status?: ProductStatus; skip?: number; take?: number }) {
      return prisma.product.findMany({
        where: {
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: {
          seller: { select: { displayName: true } },
          category: { select: { name: true } },
          images: { take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 30,
      })
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
