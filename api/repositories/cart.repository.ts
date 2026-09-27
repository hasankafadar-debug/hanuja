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

    /**
     * Row lock on the cart, held until the surrounding transaction ends. Adds to one
     * cart are serialised with it: for a product without a variant `variantId` is NULL,
     * and PostgreSQL treats NULLs as distinct in the (cartId, productId, variantId)
     * unique index, so the index alone cannot stop two concurrent adds creating two lines.
     */
    async lockCart(cartId: string) {
      await prisma.$queryRaw`SELECT id FROM carts WHERE id = ${cartId} FOR UPDATE`
    },

    /** Lines for one product and variant (`null` = no variant), oldest first. */
    findLinesForProduct(cartId: string, productId: string, variantId: string | null) {
      return prisma.cartItem.findMany({
        where: { cartId, productId, variantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    },

    createItem(params: {
      cartId: string
      productId: string
      variantId: string | null
      quantity: number
      unitPrice: import('@prisma/client/runtime/client').Decimal
    }) {
      return prisma.cartItem.create({ data: params })
    },

    deleteItems(cartId: string, itemIds: string[]) {
      return prisma.cartItem.deleteMany({ where: { cartId, id: { in: itemIds } } })
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
