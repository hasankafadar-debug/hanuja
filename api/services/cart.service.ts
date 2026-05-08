/**
 * Cart Service — sepet yönetimi.
 *
 * Sepet istemci tarafı kolaylık; checkout sunucu tarafı finansal taahhüt.
 * Sepet, fiyat snapshot'ı alır — ama checkout'ta sunucu fiyatı yeniden hesaplar.
 *
 * Kural: Sepet finansal kaynak-of-truth değildir.
 * See: cart-checkout-flow skill
 */
import type { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { calculateIncludedTax, resolveCategoryTaxRate } from '../domain/tax'
import { NotFoundError, ValidationError } from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'
import { createPlatformSettingsService } from './platform-settings.service'

interface CartServiceDeps {
  prisma: PrismaClient
}

const MAX_ITEM_QUANTITY = 99

export function createCartService({ prisma }: CartServiceDeps) {
  const carts = createCartRepository(prisma)
  const platformSettings = createPlatformSettingsService({ prisma })

  return {
    /**
     * Kullanıcının sepetini tüm ürün detaylarıyla döndürür.
     * Sepet yoksa boş yapı döner (null değil).
     */
    async getCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) {
        const settings = await platformSettings.get()
        return {
          id: null as string | null,
          items: [] as never[],
          couponCode: null as string | null,
          itemCount: 0,
          subtotal: new Decimal(0),
          taxAmount: new Decimal(0),
          freeShippingThresholdTry: settings.freeShippingThresholdTry,
          flatShippingFeeTry: settings.flatShippingFeeTry,
        }
      }

      const productIds = [...new Set(cart.items.map((item) => item.productId))]
      const [settings, products, categories] = await Promise.all([
        platformSettings.get(),
        productIds.length > 0
          ? prisma.product.findMany({
            where: { id: { in: productIds } },
            include: {
              seller: { select: { displayName: true, slug: true } },
              images: {
                orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
                take: 1,
              },
              variants: { select: { id: true, name: true } },
            },
          })
          : Promise.resolve([]),
        prisma.category.findMany({ select: { id: true, parentId: true, taxRate: true } }),
      ])
      const productMap = new Map(products.map((product) => [product.id, product]))
      const categoryMap = new Map(categories.map((category) => [category.id, category]))

      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0)
      const subtotal = cart.items.reduce(
        (sum, item) => sum.add(new Decimal(item.unitPrice).mul(item.quantity)),
        new Decimal(0),
      )
      const taxAmount = cart.items.reduce((sum, item) => {
        const product = productMap.get(item.productId)
        const rate = resolveCategoryTaxRate(product?.categoryId, categoryMap, settings.defaultTaxRate)
        return sum.add(calculateIncludedTax(new Decimal(item.unitPrice).mul(item.quantity), rate))
      }, new Decimal(0))

      return {
        ...cart,
        items: cart.items.map((item) => {
          const product = productMap.get(item.productId)
          const variant =
            item.variantId && product
              ? product.variants.find((candidate) => candidate.id === item.variantId) ?? null
              : null

          return {
            ...item,
            product: product
              ? {
                  name: product.name,
                  slug: product.slug,
                  seller: product.seller,
                  images: product.images,
                }
              : null,
            variant,
          }
        }),
        itemCount,
        subtotal,
        taxAmount,
        freeShippingThresholdTry: settings.freeShippingThresholdTry,
        flatShippingFeeTry: settings.flatShippingFeeTry,
      }
    },

    /**
     * Sepete ürün ekler. Fiyat snapshot'ı anlık ürün fiyatından alınır.
     * Stok kontrolü yapılır — yayında olmayan ürünler eklenemez.
     */
    async addItem(params: {
      userId: string
      productId: string
      quantity: number
      variantId?: string
    }) {
      if (params.quantity < 1) throw new ValidationError('Miktar en az 1 olmalıdır')
      if (params.quantity > MAX_ITEM_QUANTITY) {
        throw new ValidationError(`Miktar en fazla ${MAX_ITEM_QUANTITY} olabilir`)
      }

      const product = await prisma.product.findUnique({
        where: { id: params.productId, status: 'published' },
        include: { variants: true },
      })
      if (!product) throw new NotFoundError('Ürün', params.productId)
      if (product.variants.length > 0 && !params.variantId) {
        throw new ValidationError('LÃ¼tfen bir varyasyon seÃ§in')
      }

      const selectedVariant = params.variantId
        ? product.variants.find((variant) => variant.id === params.variantId)
        : null

      if (params.variantId && !selectedVariant) {
        throw new ValidationError('SeÃ§ilen varyasyon bulunamadÄ±')
      }

      const availableStock = selectedVariant?.stockQuantity ?? product.stockQuantity
      if (availableStock < 1) {
        throw new ValidationError('Ürün stokta bulunmuyor')
      }

      // Varyant varsa varyant fiyatı, yoksa ürün fiyatı kullan
      const unitPrice = selectedVariant?.price ?? product.price

      const cart = await carts.findOrCreate(params.userId)

      // Mevcut miktarı kontrol et
      const existingItem = (cart.items as Array<{ productId: string; variantId: string | null; quantity: number }>)
        .find(
          (i) =>
            i.productId === params.productId &&
            (i.variantId ?? '') === (params.variantId ?? ''),
        )

      if (existingItem) {
        const newQty = existingItem.quantity + params.quantity
        const maxAllowed = Math.min(availableStock, MAX_ITEM_QUANTITY)
        if (newQty > maxAllowed) {
          throw new ValidationError(
            `Sepette en fazla ${maxAllowed} adet bu ürün bulunabilir`,
          )
        }
      }

      return carts.addItem(cart.id, params.productId, params.quantity, params.variantId, unitPrice)
    },

    /**
     * Sepet kaleminin miktarını günceller.
     */
    async updateQuantity(params: { userId: string; itemId: string; quantity: number }) {
      if (params.quantity < 1) throw new ValidationError('Miktar en az 1 olmalıdır')
      if (params.quantity > MAX_ITEM_QUANTITY) {
        throw new ValidationError(`Miktar en fazla ${MAX_ITEM_QUANTITY} olabilir`)
      }

      const cart = await carts.findByUserId(params.userId)
      if (!cart) throw new NotFoundError('Sepet')

      return carts.updateItemQuantity(cart.id, params.itemId, params.quantity)
    },

    /**
     * Sepetten ürün kaldırır.
     */
    async removeItem(params: { userId: string; itemId: string }) {
      const cart = await carts.findByUserId(params.userId)
      if (!cart) throw new NotFoundError('Sepet')
      return carts.removeItem(cart.id, params.itemId)
    },

    /**
     * Sepeti tamamen boşaltır. Sipariş oluşturulduktan sonra çağrılır.
     */
    async clearCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) return
      return carts.clearCart(cart.id)
    },

    /**
     * Sepete kupon kodu uygular (sadece kaydeder, checkout'ta server doğrular).
     */
    async applyCoupon(userId: string, couponCode: string) {
      const cart = await carts.findOrCreate(userId)
      const code = couponCode.trim().toUpperCase()
      if (!code) throw new ValidationError('Geçersiz kupon kodu')
      return prisma.cart.update({
        where: { id: cart.id },
        data: { couponCode: code },
      })
    },

    /**
     * Kuponu sepetten kaldırır.
     */
    async removeCoupon(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) return
      return prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } })
    },
  }
}

export type CartService = ReturnType<typeof createCartService>
