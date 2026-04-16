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
import { NotFoundError, ValidationError } from '../lib/errors'
import { createCartRepository } from '../repositories/cart.repository'

interface CartServiceDeps {
  prisma: PrismaClient
}

const MAX_ITEM_QUANTITY = 99

export function createCartService({ prisma }: CartServiceDeps) {
  const carts = createCartRepository(prisma)

  return {
    /**
     * Kullanıcının sepetini tüm ürün detaylarıyla döndürür.
     * Sepet yoksa boş yapı döner (null değil).
     */
    async getCart(userId: string) {
      const cart = await carts.findByUserId(userId)
      if (!cart) {
        return {
          id: null as string | null,
          items: [] as never[],
          couponCode: null as string | null,
          itemCount: 0,
          subtotal: new Decimal(0),
        }
      }

      const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0)
      const subtotal = cart.items.reduce(
        (sum, item) => sum.add(new Decimal(item.unitPrice).mul(item.quantity)),
        new Decimal(0),
      )

      return { ...cart, itemCount, subtotal }
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
        include: {
          variants: params.variantId ? { where: { id: params.variantId } } : { take: 0 },
        },
      })
      if (!product) throw new NotFoundError('Ürün', params.productId)
      if (product.stockQuantity < 1) {
        throw new ValidationError('Ürün stokta bulunmuyor')
      }

      // Varyant varsa varyant fiyatı, yoksa ürün fiyatı kullan
      const unitPrice =
        params.variantId && product.variants?.[0]?.price
          ? product.variants[0].price
          : product.price

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
        const maxAllowed = Math.min(product.stockQuantity, MAX_ITEM_QUANTITY)
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
