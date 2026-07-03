import type { PrismaClient, ReturnRequestStatus } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

const messageInclude = {
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { attachments: true },
  },
  evidence: true,
  escalatedDispute: true,
} as const

export function createReturnRequestRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.returnRequest.findUnique({
        where: { id },
        include: messageInclude,
      })
    },

    /** Full detail with order context — used by seller/customer detail screens. */
    findByIdWithOrder(id: string) {
      return prisma.returnRequest.findUnique({
        where: { id },
        include: {
          ...messageInclude,
          order: {
            include: {
              lines: { include: { product: { select: { name: true } } } },
              payments: true,
            },
          },
        },
      })
    },

    /**
     * Seller-scoped detail — only resolves when the order has a line owned by
     * this seller. Enforces seller data isolation (05-security-rules.md).
     */
    findByIdForSeller(id: string, sellerId: string) {
      return prisma.returnRequest.findFirst({
        where: { id, order: { lines: { some: { sellerId } } } },
        include: {
          ...messageInclude,
          order: {
            include: {
              lines: { include: { product: { select: { name: true } } } },
              payments: true,
            },
          },
        },
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

    /** Seller provides return cargo instructions → status requested → approved. */
    setSellerCargoInfo(
      id: string,
      params: { address: string; carrier: string; instructions?: string },
    ) {
      return prisma.returnRequest.update({
        where: { id },
        data: {
          status: 'approved',
          sellerReturnAddress: params.address,
          sellerReturnCargoCarrier: params.carrier,
          ...(params.instructions !== undefined
            ? { sellerReturnInstructions: params.instructions }
            : {}),
          sellerCargoInfoProvidedAt: new Date(),
        },
      })
    },

    /** Customer ships the item back → status approved → in_transit. */
    setCustomerShipment(
      id: string,
      params: { carrier: string; trackingNumber?: string },
    ) {
      return prisma.returnRequest.update({
        where: { id },
        data: {
          status: 'in_transit',
          returnCargoProvider: params.carrier,
          ...(params.trackingNumber !== undefined
            ? { returnTrackingNumber: params.trackingNumber }
            : {}),
          customerShippedAt: new Date(),
        },
      })
    },

    /** Seller confirms physical receipt → status in_transit → received. */
    setSellerReceived(id: string) {
      return prisma.returnRequest.update({
        where: { id },
        data: { status: 'received', sellerReceivedAt: new Date() },
      })
    },

    /** Seller rejects the received item → status in_transit → rejected. */
    setSellerRejected(
      id: string,
      params: { reason: string; description?: string },
    ) {
      return prisma.returnRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          sellerRejectReason: params.reason,
          ...(params.description !== undefined
            ? { sellerRejectDescription: params.description }
            : {}),
          sellerRejectedAt: new Date(),
        },
      })
    },

    /** Link the auto-created escalation dispute (1-1). */
    linkDispute(id: string, disputeId: string) {
      return prisma.returnRequest.update({
        where: { id },
        data: { disputeId },
      })
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
            select: {
              id: true,
              publicNumber: true,
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
