import type { DisputeStatus, UserRole, PrismaClient } from '@prisma/client'
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

    listForAdmin(params: {
      status?: DisputeStatus
      skip?: number
      take?: number
    }) {
      return prisma.dispute.findMany({
        where: {
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },
  }
}

export type DisputeRepository = ReturnType<typeof createDisputeRepository>
