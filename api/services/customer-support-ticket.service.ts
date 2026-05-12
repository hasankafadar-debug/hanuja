import type {
  CustomerSupportCategory,
  CustomerSupportTicketStatus,
  PrismaClient,
} from '@prisma/client'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../lib/errors'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'

const MAX_ATTACHMENTS = 5

export function createCustomerSupportTicketService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  const auditLog = createAdminAuditLogRepository(prisma)

  async function assertReadyAttachments(assetIds: string[], ownerId: string) {
    const uniqueIds = Array.from(
      new Set(assetIds.map((id) => id.trim()).filter(Boolean)),
    ).slice(0, MAX_ATTACHMENTS)
    if (uniqueIds.length === 0) return []

    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: uniqueIds },
        uploadedBy: ownerId,
        folder: 'customer-support',
        status: 'ready',
      },
      select: { id: true },
    })

    if (assets.length !== uniqueIds.length) {
      throw new ValidationError(
        'Eklerden bazıları bulunamadı veya yükleme tamamlanmadı.',
      )
    }

    return uniqueIds
  }

  async function assertOrderOwnership(orderId: string, customerId: string) {
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true, publicNumber: true, customerId: true },
    })
    if (!order) throw new ForbiddenError('Bu sipariş size ait değil.')
    return order
  }

  async function getTicketForCustomer(ticketId: string, customerId: string) {
    const ticket = await prisma.customerSupportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: {
              include: {
                mediaAsset: {
                  select: {
                    id: true,
                    url: true,
                    originalName: true,
                    mimeType: true,
                  },
                },
              },
            },
          },
        },
      },
    })
    if (!ticket) throw new NotFoundError('Destek talebi')
    if (ticket.customerId !== customerId)
      throw new ForbiddenError('Bu destek talebine erişim yetkiniz yok.')
    return ticket
  }

  async function createMessageWithAttachments(
    tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    params: {
      ticketId: string
      authorId: string
      authorRole: 'customer' | 'admin' | 'seller'
      body: string
      attachmentAssetIds: string[]
    },
  ) {
    const message = await tx.customerSupportMessage.create({
      data: {
        ticketId: params.ticketId,
        authorId: params.authorId,
        authorRole: params.authorRole,
        body: params.body,
        ...(params.attachmentAssetIds.length > 0 && {
          attachments: {
            create: params.attachmentAssetIds.map((mediaAssetId) => ({
              mediaAssetId,
            })),
          },
        }),
      },
    })

    if (params.attachmentAssetIds.length > 0) {
      await tx.mediaAsset.updateMany({
        where: { id: { in: params.attachmentAssetIds } },
        data: { type: 'customer_support_attachment' },
      })
    }

    return message
  }

  return {
    async createForCustomer(params: {
      customerId: string
      orderId: string
      category: CustomerSupportCategory
      subject: string
      body: string
      attachmentAssetIds?: string[]
    }) {
      const {
        customerId,
        orderId,
        category,
        subject,
        body,
        attachmentAssetIds = [],
      } = params

      await assertOrderOwnership(orderId, customerId)
      const assetIds = await assertReadyAttachments(
        attachmentAssetIds,
        customerId,
      )

      return prisma.$transaction(async (tx) => {
        const existing = await tx.customerSupportTicket.findFirst({
          where: { orderId, customerId, status: { not: 'resolved' } },
        })
        if (existing) {
          throw new ConflictError(
            'Bu sipariş için zaten açık bir destek talebiniz var.',
          )
        }

        const ticket = await tx.customerSupportTicket.create({
          data: {
            customerId,
            orderId,
            category,
            subject,
            status: 'waiting_for_admin',
            lastCustomerMessageAt: new Date(),
          },
        })

        await createMessageWithAttachments(tx, {
          ticketId: ticket.id,
          authorId: customerId,
          authorRole: 'customer',
          body,
          attachmentAssetIds: assetIds,
        })

        return ticket
      })
    },

    async replyAsCustomer(params: {
      ticketId: string
      customerId: string
      body: string
      attachmentAssetIds?: string[]
    }) {
      const { ticketId, customerId, body, attachmentAssetIds = [] } = params

      const ticket = await getTicketForCustomer(ticketId, customerId)
      if (ticket.status === 'resolved') {
        throw new ValidationError(
          'Bu destek talebi kapatılmış. Yeni bir talep açabilirsiniz.',
        )
      }

      const assetIds = await assertReadyAttachments(
        attachmentAssetIds,
        customerId,
      )

      return prisma.$transaction(async (tx) => {
        const msg = await createMessageWithAttachments(tx, {
          ticketId,
          authorId: customerId,
          authorRole: 'customer',
          body,
          attachmentAssetIds: assetIds,
        })
        await tx.customerSupportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'waiting_for_admin',
            lastCustomerMessageAt: new Date(),
          },
        })
        return msg
      })
    },

    async replyAsAdmin(params: {
      ticketId: string
      adminActorId: string
      body: string
      attachmentAssetIds?: string[]
    }) {
      const { ticketId, adminActorId, body, attachmentAssetIds = [] } = params

      const ticket = await prisma.customerSupportTicket.findUnique({
        where: { id: ticketId },
      })
      if (!ticket) throw new NotFoundError('Destek talebi')
      if (ticket.status === 'resolved')
        throw new ValidationError('Bu destek talebi kapatılmış.')

      const assetIds = await assertReadyAttachments(
        attachmentAssetIds,
        adminActorId,
      )

      return prisma.$transaction(async (tx) => {
        const msg = await createMessageWithAttachments(tx, {
          ticketId,
          authorId: adminActorId,
          authorRole: 'admin',
          body,
          attachmentAssetIds: assetIds,
        })
        await tx.customerSupportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'waiting_for_customer',
            lastAdminMessageAt: new Date(),
          },
        })
        await auditLog.createEntry({
          actorId: adminActorId,
          actionType: 'customer_support_replied',
          targetType: 'customer_support_ticket',
          targetId: ticketId,
          newData: { messageId: msg.id },
        })
        return msg
      })
    },

    async resolveByAdmin(params: {
      ticketId: string
      adminActorId: string
      note?: string
    }) {
      const { ticketId, adminActorId, note } = params

      const ticket = await prisma.customerSupportTicket.findUnique({
        where: { id: ticketId },
      })
      if (!ticket) throw new NotFoundError('Destek talebi')
      if (ticket.status === 'resolved') return ticket // idempotent

      return prisma.$transaction(async (tx) => {
        const updated = await tx.customerSupportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolvedById: adminActorId,
            resolutionNote: note ?? null,
          },
        })
        await auditLog.createEntry({
          actorId: adminActorId,
          actionType: 'customer_support_resolved',
          targetType: 'customer_support_ticket',
          targetId: ticketId,
          previousData: { status: ticket.status },
          newData: { status: 'resolved', resolutionNote: note ?? null },
        })
        return updated
      })
    },

    async listForCustomer(customerId: string, orderId?: string) {
      return prisma.customerSupportTicket.findMany({
        where: { customerId, ...(orderId ? { orderId } : {}) },
        orderBy: { createdAt: 'desc' },
        include: {
          messages: { orderBy: { createdAt: 'asc' }, take: 1 },
        },
      })
    },

    async findOpenForOrder(orderId: string, customerId: string) {
      return prisma.customerSupportTicket.findFirst({
        where: { orderId, customerId, status: { not: 'resolved' } },
      })
    },

    async listForAdmin(params?: {
      status?: CustomerSupportTicketStatus
      take?: number
      skip?: number
    }) {
      const { status, take = 50, skip = 0 } = params ?? {}
      const where = status ? { status } : {}

      const [items, total] = await prisma.$transaction([
        prisma.customerSupportTicket.findMany({
          where,
          orderBy: { lastCustomerMessageAt: 'desc' },
          take,
          skip,
          include: {
            customer: { select: { id: true, name: true, email: true } },
            order: { select: { id: true, publicNumber: true } },
            resolvedBy: { select: { id: true, name: true } },
          },
        }),
        prisma.customerSupportTicket.count({ where }),
      ])

      return { items, total }
    },

    getByIdForCustomer: getTicketForCustomer,

    async getByIdForAdmin(ticketId: string) {
      const ticket = await prisma.customerSupportTicket.findUnique({
        where: { id: ticketId },
        include: {
          customer: { select: { id: true, name: true, email: true } },
          order: { select: { id: true, publicNumber: true, status: true } },
          resolvedBy: { select: { id: true, name: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            include: {
              author: { select: { id: true, name: true, role: true } },
              attachments: {
                include: {
                  mediaAsset: {
                    select: {
                      id: true,
                      url: true,
                      originalName: true,
                      mimeType: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      if (!ticket) throw new NotFoundError('Destek talebi')
      return ticket
    },
  }
}
