import type { PrismaClient } from '@prisma/client'

export function createOrderLineRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.orderLine.findUnique({
        where: { id },
        include: { product: true, order: true },
      })
    },

    findByOrderId(orderId: string) {
      return prisma.orderLine.findMany({
        where: { orderId },
        include: { product: true },
      })
    },

    /** Seller-scoped — only their lines */
    findByOrderIdForSeller(orderId: string, sellerId: string) {
      return prisma.orderLine.findMany({
        where: { orderId, sellerId },
        include: { product: true },
      })
    },

    findBySellerForPayout(sellerId: string) {
      return prisma.orderLine.findMany({
        where: { sellerId },
        include: { product: true, payout: true },
      })
    },
  }
}

export type OrderLineRepository = ReturnType<typeof createOrderLineRepository>
