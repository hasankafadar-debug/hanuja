import type { PrismaClient, ReturnRequestStatus } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createReturnRequestRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.returnRequest.findUnique({
        where: { id },
        include: { messages: { orderBy: { createdAt: 'asc' } }, evidence: true },
      })
    },

    findByOrderId(orderId: string) {
      return prisma.returnRequest.findFirst({
        where: { orderId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    },

    create(data: {
      orderId: string
      customerId: string
      reason: string
      description?: string
      isWithinWindow: boolean
    }) {
      return prisma.returnRequest.create({ data })
    },

    updateStatus(id: string, status: ReturnRequestStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.returnRequest.update({ where: { id }, data: { status } })
    },

    review(
      id: string,
      params: {
        status: ReturnRequestStatus
        reviewedBy: string
        reviewNote?: string
      },
    ) {
      return prisma.returnRequest.update({
        where: { id },
        data: {
          status: params.status,
          reviewedBy: params.reviewedBy,
          reviewedAt: new Date(),
          ...(params.reviewNote !== undefined ? { reviewNote: params.reviewNote } : {}),
        },
      })
    },

    markRefunded(id: string, refundAmount: Decimal) {
      return prisma.returnRequest.update({
        where: { id },
        data: { status: 'refund_completed', refundAmount, refundedAt: new Date() },
      })
    },

    listForAdmin(params: {
      status?: ReturnRequestStatus
      skip?: number
      take?: number
    }) {
      return prisma.returnRequest.findMany({
        where: {
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    /**
     * List return requests for a seller — filtered via order line ownership.
     * Seller sees returns on orders that contain their products.
     */
    listForSeller(params: { sellerId: string; skip?: number; take?: number }) {
      return prisma.returnRequest.findMany({
        where: {
          order: { lines: { some: { sellerId: params.sellerId } } },
        },
        include: {
          order: {
            include: {
              lines: {
                where: { sellerId: params.sellerId },
                include: { product: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 30,
      })
    },

    /** Count open returns that block payout for a given order */
    countOpenByOrderId(orderId: string) {
      return prisma.returnRequest.count({
        where: {
          orderId,
          status: { notIn: ['rejected', 'refund_completed'] },
        },
      })
    },
  }
}

export type ReturnRequestRepository = ReturnType<typeof createReturnRequestRepository>
