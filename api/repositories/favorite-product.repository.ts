import type { PrismaClient } from '@prisma/client'

export function createFavoriteProductRepository(prisma: PrismaClient) {
  return {
    findByUserAndProduct(userId: string, productId: string) {
      return prisma.favoriteProduct.findUnique({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      })
    },

    createIfMissing(userId: string, productId: string) {
      return prisma.favoriteProduct.upsert({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
        update: {},
        create: {
          userId,
          productId,
        },
      })
    },

    removeByUserAndProduct(userId: string, productId: string) {
      return prisma.favoriteProduct.deleteMany({
        where: {
          userId,
          productId,
        },
      })
    },

    listPublishedByUser(userId: string) {
      return prisma.favoriteProduct.findMany({
        where: {
          userId,
          product: {
            is: {
              status: 'published',
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            include: {
              images: {
                take: 4,
                orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
              },
              seller: {
                select: {
                  displayName: true,
                  slug: true,
                },
              },
            },
          },
        },
      })
    },

    listFavoriteProductIds(userId: string) {
      return prisma.favoriteProduct.findMany({
        where: { userId },
        select: { productId: true },
      })
    },
  }
}

export type FavoriteProductRepository = ReturnType<typeof createFavoriteProductRepository>
