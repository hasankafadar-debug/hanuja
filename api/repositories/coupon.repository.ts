import type { PrismaClient } from '@prisma/client'

export function createCouponRepository(prisma: PrismaClient) {
  return {
    findByCode(code: string) {
      return prisma.coupon.findUnique({ where: { code } })
    },

    findById(id: string) {
      return prisma.coupon.findUnique({ where: { id } })
    },

    countUsageByUser(couponId: string, userId: string) {
      return prisma.couponUsage.count({ where: { couponId, userId } })
    },

    incrementUsage(couponId: string, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.coupon.update({
        where: { id: couponId },
        data: { usageCount: { increment: 1 } },
      })
    },

    recordUsage(couponId: string, userId: string, orderId: string, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.couponUsage.create({
        data: { couponId, userId, orderId },
      })
    },

    findUsageByOrder(orderId: string) {
      return prisma.couponUsage.findUnique({
        where: { orderId },
        include: { coupon: true },
      })
    },

    listForAdmin(params: { skip?: number; take?: number; isActive?: boolean }) {
      return prisma.coupon.findMany({
        ...(params.isActive !== undefined ? { where: { isActive: params.isActive } } : {}),
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 50,
      })
    },

    /** Seller-scoped — only coupons owned by this seller (Coupon.sellerId). */
    listBySeller(sellerId: string, params: { skip?: number; take?: number } = {}) {
      return prisma.coupon.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 50,
      })
    },

    create(data: {
      code: string
      sellerId?: string | null
      discountType: 'percentage' | 'fixed_amount'
      discountValue: number
      minCartTotal?: number
      maxUsageTotal?: number
      maxUsagePerUser?: number
      isActive?: boolean
      startsAt?: Date
      expiresAt?: Date
    }) {
      return prisma.coupon.create({ data: data as never })
    },

    update(
      id: string,
      data: {
        sellerId?: string | null
        isActive?: boolean
        expiresAt?: Date | null
        maxUsageTotal?: number | null
      },
    ) {
      return prisma.coupon.update({ where: { id }, data })
    },
  }
}

export type CouponRepository = ReturnType<typeof createCouponRepository>
