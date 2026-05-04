import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Decimal } from '../../__mocks__/prisma-runtime'
import { NotFoundError } from '../../../api/lib/errors'
import { createFavoriteProductService } from '../../../api/services/favorite-product.service'

type ProductRow = {
  id: string
  slug: string
  name: string
  status: 'published' | 'draft'
  price: Decimal
  compareAtPrice: Decimal | null
  images: Array<{ url: string; isPrimary?: boolean; sortOrder?: number }>
  seller: { displayName: string; slug: string }
}

function createMockPrisma() {
  const users = [{ id: 'user-1', email: 'customer@example.com' }]
  const products = new Map<string, ProductRow>([
    [
      'product-1',
      {
        id: 'product-1',
        slug: 'yildiz-lamba',
        name: 'Yildiz Lamba',
        status: 'published',
        price: new Decimal(1200),
        compareAtPrice: new Decimal(1500),
        images: [{ url: 'https://cdn.example.com/lamba.jpg', isPrimary: true, sortOrder: 0 }],
        seller: { displayName: 'Atolye Kuzey', slug: 'atolye-kuzey' },
      },
    ],
    [
      'product-2',
      {
        id: 'product-2',
        slug: 'taslak-urun',
        name: 'Taslak Urun',
        status: 'draft',
        price: new Decimal(800),
        compareAtPrice: null,
        images: [{ url: 'https://cdn.example.com/taslak.jpg', isPrimary: true, sortOrder: 0 }],
        seller: { displayName: 'Atolye Kuzey', slug: 'atolye-kuzey' },
      },
    ],
  ])

  const favorites: Array<{ id: string; userId: string; productId: string; createdAt: Date }> = []

  return {
    _products: products,
    _favorites: favorites,
    user: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return users.find((user) => user.id === where.id) ?? null
      }),
    },
    product: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
        return products.get(where.id) ?? null
      }),
    },
    favoriteProduct: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { userId_productId: { userId: string; productId: string } } }) => {
        return (
          favorites.find(
            (favorite) =>
              favorite.userId === where.userId_productId.userId &&
              favorite.productId === where.userId_productId.productId,
          ) ?? null
        )
      }),
      upsert: vi.fn().mockImplementation(
        async ({
          where,
          create,
        }: {
          where: { userId_productId: { userId: string; productId: string } }
          update: Record<string, never>
          create: { userId: string; productId: string }
        }) => {
          const existing = favorites.find(
            (favorite) =>
              favorite.userId === where.userId_productId.userId &&
              favorite.productId === where.userId_productId.productId,
          )

          if (existing) return existing

          const record = {
            id: `favorite-${favorites.length + 1}`,
            userId: create.userId,
            productId: create.productId,
            createdAt: new Date(Date.UTC(2026, 3, favorites.length + 1)),
          }
          favorites.push(record)
          return record
        },
      ),
      deleteMany: vi.fn().mockImplementation(async ({ where }: { where: { userId: string; productId: string } }) => {
        const before = favorites.length
        const remaining = favorites.filter(
          (favorite) => !(favorite.userId === where.userId && favorite.productId === where.productId),
        )
        favorites.splice(0, favorites.length, ...remaining)
        return { count: before - favorites.length }
      }),
      findMany: vi.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
        return favorites
          .filter((favorite) => favorite.userId === where.userId)
          .map((favorite) => ({
            ...favorite,
            product: products.get(favorite.productId)!,
          }))
          .filter((favorite) => favorite.product.status === 'published')
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      }),
    },
  }
}

describe('FavoriteProductService', () => {
  let prisma: ReturnType<typeof createMockPrisma>
  let service: ReturnType<typeof createFavoriteProductService>

  beforeEach(() => {
    prisma = createMockPrisma()
    service = createFavoriteProductService({ prisma: prisma as never })
  })

  it('adds a published product to favorites', async () => {
    const result = await service.addFavorite('user-1', 'product-1')

    expect(result).toEqual({ success: true, isFavorite: true })
    expect(prisma.favoriteProduct.upsert).toHaveBeenCalledTimes(1)
  })

  it('keeps favorite creation idempotent for duplicate requests', async () => {
    await service.addFavorite('user-1', 'product-1')
    await service.addFavorite('user-1', 'product-1')

    const favorites = await service.listFavorites('user-1')
    expect(favorites).toHaveLength(1)
    expect(favorites[0]?.id).toBe('product-1')
  })

  it('removes a favorite product', async () => {
    await service.addFavorite('user-1', 'product-1')
    const result = await service.removeFavorite('user-1', 'product-1')

    expect(result).toEqual({ success: true, isFavorite: false })

    const favorites = await service.listFavorites('user-1')
    expect(favorites).toHaveLength(0)
  })

  it('rejects non-published products', async () => {
    await expect(service.addFavorite('user-1', 'product-2')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns favorite status', async () => {
    await service.addFavorite('user-1', 'product-1')

    await expect(service.isFavorite('user-1', 'product-1')).resolves.toEqual({ isFavorite: true })
    await expect(service.isFavorite('user-1', 'product-2')).resolves.toEqual({ isFavorite: false })
  })

  it('returns favorite product ids for bulk catalog hydration', async () => {
    await service.addFavorite('user-1', 'product-1')

    await expect(service.listFavoriteIds('user-1')).resolves.toEqual(['product-1'])
  })

  it('does not list products that are no longer published', async () => {
    await service.addFavorite('user-1', 'product-1')
    const product = prisma._products.get('product-1')
    if (product) {
      product.status = 'draft'
    }

    const favorites = await service.listFavorites('user-1')
    expect(favorites).toHaveLength(0)
  })
})
