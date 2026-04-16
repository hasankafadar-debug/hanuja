import type { PrismaClient } from '@prisma/client'

export function createCouponRepository(prisma: PrismaClient) {
  return {
    findByCode(code: string) {
      return prisma.coupon.findUnique({ where: { code } })
    },

    countUsageByUser(couponId: string, userId: string) {
      return prisma.couponUsage.count({ where: { couponId, userId } })
    },

    incrementUsage(couponId: string) {
      return prisma.coupon.update({
        where: { id: couponId },
        data: { usageCount: { increment: 1 } },
      })
    },

    recordUsage(couponId: string, userId: string, orderId: string) {
      return prisma.couponUsage.create({
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
        where: params.isActive !== undefined ? { isActive: params.isActive } : undefined,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 50,
      })
    },

    create(data: {
      code: string
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

    update(id: string, data: { isActive?: boolean; expiresAt?: Date }) {
      return prisma.coupon.update({ where: { id }, data })
    },
  }
}

export type CouponRepository = ReturnType<typeof createCouponRepository>
