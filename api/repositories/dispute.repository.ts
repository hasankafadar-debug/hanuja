import type { DisputeStatus, Prisma, UserRole, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createDisputeRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.dispute.findUnique({
        where: { id },
        include: { messages: { orderBy: { createdAt: 'asc' } }, evidence: true },
      })
    },

    findByOrderId(orderId: string) {
      return prisma.dispute.findFirst({
        where: { orderId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    },

    create(data: {
      orderId: string
      openedById: string
      reason: string
      description?: string
    }) {
      return prisma.dispute.create({ data })
    },

    resolve(
      id: string,
      params: {
        status: 'resolved_for_customer' | 'resolved_for_seller'
        resolvedBy: string
        resolution: string
        payoutBlocked: boolean
        refundAmount?: Decimal
      },
    ) {
      return prisma.dispute.update({
        where: { id },
        data: {
          status: params.status,
          resolvedBy: params.resolvedBy,
          resolvedAt: new Date(),
          resolution: params.resolution,
          payoutBlocked: params.payoutBlocked,
          ...(params.refundAmount !== undefined ? { refundAmount: params.refundAmount } : {}),
        },
      })
    },

    addMessage(data: {
      disputeId: string
      authorId: string
      authorRole: UserRole
      body: string
    }) {
      return prisma.disputeMessage.create({ data })
    },

    countOpenByOrderId(orderId: string) {
      return prisma.dispute.count({
        where: { orderId, status: 'open' },
      })
    },

    async listForAdmin(params: {
      status?: DisputeStatus[]
      sellerId?: string
      query?: string
      from?: Date
      to?: Date
      skip?: number
      take?: number
    }) {
      const normalizedQuery = params.query?.trim()
      const where: Prisma.DisputeWhereInput = {
        ...(params.status !== undefined && params.status.length > 0 ? { status: { in: params.status } } : {}),
        ...(params.sellerId !== undefined
          ? { order: { lines: { some: { sellerId: params.sellerId } } } }
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
                { id: { contains: normalizedQuery } },
                { orderId: { contains: normalizedQuery } },
                { reason: { contains: normalizedQuery, mode: 'insensitive' } },
                { order: { customer: { name: { contains: normalizedQuery, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.dispute.findMany({
          where,
          include: {
            order: {
              include: {
                customer: { select: { name: true } },
                lines: { select: { sellerId: true }, take: 1 },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          ...(params.skip !== undefined ? { skip: params.skip } : {}),
          take: params.take ?? 20,
        }),
        prisma.dispute.count({ where }),
      ])

      return { rows, total }
    },
  }
}

export type DisputeRepository = ReturnType<typeof createDisputeRepository>
