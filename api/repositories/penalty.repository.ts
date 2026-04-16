import type { PenaltyReason, PenaltyStatus, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createPenaltyRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.penalty.findUnique({ where: { id } })
    },

    findByOrderId(orderId: string) {
      return prisma.penalty.findFirst({ where: { orderId } })
    },

    create(
      data: {
        sellerId: string
        orderId: string
        reason: PenaltyReason
        baseAmount: Decimal
        rate: Decimal
        penaltyAmount: Decimal
      },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.penalty.create({ data })
    },

    waive(
      id: string,
      params: { waivedBy: string; waiverReason: string },
    ) {
      // History-preserving waiver — original penalty record is NOT deleted.
      // Status changes to 'waived', original amounts remain for audit.
      return prisma.penalty.update({
        where: { id },
        data: {
          status: 'waived',
          waivedBy: params.waivedBy,
          waivedAt: new Date(),
          waiverReason: params.waiverReason,
        },
      })
    },

    markOffsetted(id: string, payoutId: string) {
      return prisma.penalty.update({
        where: { id },
        data: { status: 'offset', offsetPayoutId: payoutId },
      })
    },

    listBySeller(params: {
      sellerId: string
      status?: PenaltyStatus
      skip?: number
      take?: number
    }) {
      return prisma.penalty.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    listForAdmin(params: {
      sellerId?: string
      status?: PenaltyStatus
      skip?: number
      take?: number
    }) {
      return prisma.penalty.findMany({
        where: {
          ...(params.sellerId !== undefined ? { sellerId: params.sellerId } : {}),
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { seller: { include: { profile: true } }, order: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },
  }
}

export type PenaltyRepository = ReturnType<typeof createPenaltyRepository>
