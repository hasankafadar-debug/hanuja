import type { Prisma, PrismaClient, SellerStatus } from '@prisma/client'

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

    async listForAdmin(params: {
      status?: SellerStatus
      importPermission?: 'pending' | 'active' | 'none'
      query?: string
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const where: Prisma.SellerWhereInput = {
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.importPermission === 'pending'
          ? { importEnabled: false, importRequestedAt: { not: null } }
          : params.importPermission === 'active'
            ? { importEnabled: true }
            : params.importPermission === 'none'
              ? { importEnabled: false, importRequestedAt: null }
              : {}),
        ...(params.from !== undefined || params.to !== undefined
          ? {
              createdAt: {
                ...(params.from !== undefined ? { gte: params.from } : {}),
                ...(params.to !== undefined ? { lte: params.to } : {}),
              },
            }
          : {}),
        ...(normalizedQuery
          ? {
              OR: [
                { displayName: { contains: normalizedQuery, mode: 'insensitive' } },
                { slug: { contains: normalizedQuery, mode: 'insensitive' } },
                { user: { name: { contains: normalizedQuery, mode: 'insensitive' } } },
                { user: { email: { contains: normalizedQuery, mode: 'insensitive' } } },
                { profile: { city: { contains: normalizedQuery, mode: 'insensitive' } } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.seller.findMany({
          where,
          include: { profile: true, user: { select: { email: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        prisma.seller.count({ where }),
      ])

      return { rows, total }
    },

    countByStatus(status?: SellerStatus) {
      return prisma.seller.count({
        where: {
          ...(status !== undefined ? { status } : {}),
        },
      })
    },

    listActiveForStorefront() {
      return prisma.seller.findMany({
        where: { status: 'active' },
        include: { profile: true },
        orderBy: { displayName: 'asc' },
      })
    },
  }
}

export type SellerRepository = ReturnType<typeof createSellerRepository>
