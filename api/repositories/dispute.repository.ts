import type { DisputeStatus, Prisma, UserRole, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'
import { canViewAllDisputes, type DisputeViewer } from '../lib/dispute-authorization'

const participantMediaSelect = {
  id: true,
  type: true,
  kind: true,
  originalName: true,
  mimeType: true,
  createdAt: true,
} as const

const participantDisputeSelect = {
  id: true,
  orderId: true,
  status: true,
  reason: true,
  description: true,
  resolution: true,
  payoutBlocked: true,
  refundAmount: true,
  createdAt: true,
  updatedAt: true,
  messages: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      authorRole: true,
      body: true,
      createdAt: true,
    },
  },
  evidence: { select: participantMediaSelect },
  escalatedFromReturn: {
    select: {
      id: true,
      status: true,
      reason: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          authorRole: true,
          body: true,
          createdAt: true,
          attachments: { select: participantMediaSelect },
        },
      },
      evidence: { select: participantMediaSelect },
    },
  },
} as const

const staffDisputeSelect = {
  ...participantDisputeSelect,
  order: {
    select: {
      id: true,
      publicNumber: true,
      customer: { select: { name: true } },
      lines: { select: { sellerId: true } },
    },
  },
} as const

const messageTargetSelect = {
  id: true,
  status: true,
} as const

export function createDisputeRepository(prisma: PrismaClient) {
  const participantWhere = (id: string, viewerId: string): Prisma.DisputeWhereInput => ({
    id,
    OR: [
      { order: { customerId: viewerId } },
      { order: { lines: { some: { seller: { userId: viewerId } } } } },
    ],
  })

  const findByIdForViewer = (id: string, viewer: DisputeViewer) => {
    if (canViewAllDisputes(viewer.viewerRole)) {
      return prisma.dispute.findUnique({
        where: { id },
        select: staffDisputeSelect,
      })
    }

    return prisma.dispute.findFirst({
      where: participantWhere(id, viewer.viewerId),
      select: participantDisputeSelect,
    })
  }

  const findMessageTargetForViewer = (id: string, viewer: DisputeViewer) => {
    if (canViewAllDisputes(viewer.viewerRole)) {
      return prisma.dispute.findUnique({
        where: { id },
        select: messageTargetSelect,
      })
    }

    return prisma.dispute.findFirst({
      where: participantWhere(id, viewer.viewerId),
      select: messageTargetSelect,
    })
  }

  return {
    /**
     * Details are scoped in the database. A null result means either that the
     * dispute does not exist or that this viewer is not a participant.
     */
    findByIdForViewer,

    /** Message writes use the same ownership-scoped lookup as reads. */
    findMessageTargetForViewer,

    /** Trusted internal/admin workflow projection; never call for a normal viewer. */
    findByIdForAdmin(id: string) {
      return prisma.dispute.findUnique({
        where: { id },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          evidence: true,
          escalatedFromReturn: {
            include: {
              items: { include: { orderLine: true } },
              messages: {
                orderBy: { createdAt: 'asc' },
                include: { attachments: true },
              },
              evidence: true,
              order: {
                include: {
                  lines: { include: { product: { select: { name: true } } } },
                  payments: true,
                },
              },
            },
          },
        },
      })
    },

    findByOrderId(orderId: string) {
      return prisma.dispute.findFirst({
        where: { orderId },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      })
    },

    create(data: { orderId: string; openedById: string; reason: string; description?: string }) {
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

    addMessage(data: { disputeId: string; authorId: string; authorRole: UserRole; body: string }) {
      return prisma.disputeMessage.create({ data })
    },

    countOpenByOrderId(orderId: string) {
      return prisma.dispute.count({
        where: { orderId, status: 'open' },
      })
    },

    countOpenByOrderAndSeller(orderId: string, sellerId: string) {
      return prisma.dispute.count({
        where: {
          orderId,
          status: 'open',
          OR: [
            { escalatedFromReturn: { sellerId } },
            { escalatedFromReturn: null },
          ],
        },
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
        ...(params.status !== undefined && params.status.length > 0
          ? { status: { in: params.status } }
          : {}),
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
                {
                  order: {
                    customer: {
                      name: { contains: normalizedQuery, mode: 'insensitive' },
                    },
                  },
                },
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
