import type { PrismaClient } from '@prisma/client'
import { NotFoundError } from '../lib/errors'
import { createFavoriteProductRepository } from '../repositories/favorite-product.repository'
import { createProductRepository } from '../repositories/product.repository'
import { createUserRepository } from '../repositories/user.repository'
import { createProductAnalyticsService } from './product-analytics.service'

export function createFavoriteProductService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps
  const users = createUserRepository(prisma)
  const products = createProductRepository(prisma)
  const favorites = createFavoriteProductRepository(prisma)
  const productAnalytics = createProductAnalyticsService({ prisma })

  async function assertUserExists(userId: string) {
    const user = await users.findById(userId)
    if (!user) throw new NotFoundError('User', userId)
  }

  async function getPublishedProduct(productId: string) {
    const product = await products.findById(productId)
    if (!product || product.status !== 'published') {
      throw new NotFoundError('Product', productId)
    }

    return product
  }

  return {
    async listFavorites(userId: string) {
      await assertUserExists(userId)

      const items = await favorites.listPublishedByUser(userId)
      return items.map((item) => ({
        id: item.product.id,
        slug: item.product.slug,
        name: item.product.name,
        price: item.product.price,
        compareAtPrice: item.product.compareAtPrice,
        imageUrl: item.product.images[0]?.url ?? null,
        imageUrls: item.product.images.map((image) => image.url),
        sellerName: item.product.seller?.displayName ?? null,
        sellerSlug: item.product.seller?.slug ?? null,
        favoritedAt: item.createdAt,
      }))
    },

    async listFavoriteIds(userId: string) {
      await assertUserExists(userId)

      const items = await favorites.listFavoriteProductIds(userId)
      return items.map((item) => item.productId)
    },

    async isFavorite(userId: string, productId: string) {
      await assertUserExists(userId)

      const favorite = await favorites.findByUserAndProduct(userId, productId)
      return { isFavorite: Boolean(favorite) }
    },

    async addFavorite(userId: string, productId: string) {
      await assertUserExists(userId)
      await getPublishedProduct(productId)
      await favorites.createIfMissing(userId, productId)
      await productAnalytics.recordProductEvent({
        productId,
        userId,
        eventType: 'favorite_add',
      }).catch((error) => {
        console.error('[analytics] Failed to record favorite_add event', error)
      })
      return { success: true, isFavorite: true }
    },

    async removeFavorite(userId: string, productId: string) {
      await assertUserExists(userId)
      await favorites.removeByUserAndProduct(userId, productId)
      return { success: true, isFavorite: false }
    },
  }
}
