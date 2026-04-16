import type { PrismaClient, SellerStatus } from '@prisma/client'

export function createSellerRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.seller.findUnique({
        where: { id },
        include: { profile: true, bankDetails: true },
      })
    },

    findByUserId(userId: string) {
      return prisma.seller.findUnique({ where: { userId } })
    },

    findBySlug(slug: string) {
      return prisma.seller.findUnique({ where: { slug } })
    },

    findBySlugWithProfile(slug: string) {
      return prisma.seller.findUnique({
        where: { slug, status: 'active' },
        include: { profile: true },
      })
    },

    findActiveById(id: string) {
      return prisma.seller.findUnique({ where: { id, status: 'active' } })
    },

    updateStatus(id: string, status: SellerStatus) {
      return prisma.seller.update({ where: { id }, data: { status } })
    },

    listForAdmin(params: {
      status?: SellerStatus
      skip?: number
      take?: number
    }) {
      return prisma.seller.findMany({
        where: {
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    countByStatus(status?: SellerStatus) {
      return prisma.seller.count({
        where: {
          ...(status !== undefined ? { status } : {}),
        },
      })
    },
  }
}

export type SellerRepository = ReturnType<typeof createSellerRepository>
