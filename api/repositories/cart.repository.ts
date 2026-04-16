import type { PrismaClient } from '@prisma/client'

export function createCartRepository(prisma: PrismaClient) {
  return {
    findByUserId(userId: string) {
      return prisma.cart.findUnique({
        where: { userId },
        include: { items: true },
      })
    },

    findOrCreate(userId: string) {
      return prisma.cart.upsert({
        where: { userId },
        create: { userId },
        update: {},
        include: { items: true },
      })
    },

    addItem(
      cartId: string,
      productId: string,
      quantity: number,
      variantId: string | undefined,
      unitPrice: import('@prisma/client/runtime/client').Decimal,
    ) {
      return prisma.cartItem.upsert({
        where: {
          cartId_productId_variantId: {
            cartId,
            productId,
            variantId: variantId ?? '',
          },
        },
        create: { cartId, productId, quantity, unitPrice, ...(variantId !== undefined ? { variantId } : {}) },
        update: { quantity: { increment: quantity } },
      })
    },

    updateItemQuantity(cartId: string, itemId: string, quantity: number) {
      return prisma.cartItem.update({
        where: { id: itemId, cartId },
        data: { quantity },
      })
    },

    removeItem(cartId: string, itemId: string) {
      return prisma.cartItem.delete({ where: { id: itemId, cartId } })
    },

    clearCart(cartId: string) {
      return prisma.cartItem.deleteMany({ where: { cartId } })
    },
  }
}

export type CartRepository = ReturnType<typeof createCartRepository>
