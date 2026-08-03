import type { PrismaClient } from '@prisma/client'
import { ForbiddenError, NotFoundError, ValidationError } from '../lib/errors'
import { createNotificationService } from './notification.service'

const supportAttachmentMediaSelect = {
  id: true,
  originalName: true,
} as const

export function createSupportTicketService({ prisma }: { prisma: PrismaClient }) {
  const notifications = createNotificationService({ prisma })

  async function assertReadyAttachments(assetIds: string[], ownerId: string) {
    const uniqueIds = Array.from(new Set(assetIds.map((id) => id.trim()).filter(Boolean))).slice(
      0,
      5,
    )
    if (uniqueIds.length === 0) return []

    const assets = await prisma.mediaAsset.findMany({
      where: {
        id: { in: uniqueIds },
        uploadedBy: ownerId,
        folder: 'documents',
        status: 'ready',
      },
      select: { id: true },
    })

    if (assets.length !== uniqueIds.length) {
      throw new ValidationError('Eklerden bazıları bulunamadı veya yükleme tamamlanmadı.')
    }

    return uniqueIds
  }

  async function getSellerWithUser(sellerId: string) {
    return prisma.seller.findUnique({
      where: { id: sellerId },
      include: {
        user: {
          select: { id: true, email: true, name: true, role: true },
        },
      },
    })
  }

  async function assertSellerOrderOwnership(orderId: string, sellerId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        lines: {
          some: { sellerId },
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
      },
    })

    if (!order) {
      throw new ValidationError('Seçilen sipariş bu mağazaya ait değil veya bulunamadı.')
    }

    return order
  }

  async function notifyAdminsAboutNewTicket(params: {
    ticketId: string
    sellerId: string
    sellerName: string
    subject: string
    orderId?: string | null
  }) {
    const admins = await prisma.user.findMany({
      where: { role: 'admin' },
      select: { id: true },
    })

    await Promise.all(
      admins.map((admin) =>
        notifications.send({
          userId: admin.id,
          type: 'admin_support_new_ticket',
          title: 'Yeni destek talebi',
          body: `${params.sellerName} mağazası "${params.subject}" başlıklı yeni bir destek talebi açtı.`,
          data: {
            ticketId: params.ticketId,
            sellerId: params.sellerId,
            orderId: params.orderId ?? null,
          },
        }),
      ),
    )
  }

  async function getTicketForSeller(ticketId: string, sellerId: string) {
    const ticket = await prisma.supportTicket.findFirst({
      where: { id: ticketId, sellerId },
      include: {
        seller: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
          },
        },
        order: {
          select: { id: true, status: true, createdAt: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: { id: true, name: true, email: true, role: true },
            },
            attachments: {
              include: { mediaAsset: { select: supportAttachmentMediaSelect } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })

    if (!ticket) {
      throw new NotFoundError('Destek talebi', ticketId)
    }

    return ticket
  }

  async function getTicketForAdmin(ticketId: string) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        seller: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true },
            },
            profile: true,
          },
        },
        order: {
          select: { id: true, status: true, createdAt: true },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: { id: true, name: true, email: true, role: true },
            },
            attachments: {
              include: { mediaAsset: { select: supportAttachmentMediaSelect } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    })

    if (!ticket) {
      throw new NotFoundError('Destek talebi', ticketId)
    }

    return ticket
  }

  return {
    listForSeller(sellerId: string) {
      return prisma.supportTicket.findMany({
        where: { sellerId },
        include: {
          order: {
            select: { id: true, status: true, createdAt: true },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              author: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      })
    },

    getForSeller(ticketId: string, sellerId: string) {
      return getTicketForSeller(ticketId, sellerId)
    },

    async createForSeller(params: {
      sellerId: string
      authorId: string
      subject: string
      body: string
      orderId?: string | null
      attachmentAssetIds?: string[]
    }) {
      const seller = await getSellerWithUser(params.sellerId)
      if (!seller || seller.userId !== params.authorId) {
        throw new ForbiddenError('Bu mağaza için destek talebi oluşturma yetkiniz yok.')
      }

      const subject = params.subject.trim()
      const body = params.body.trim()

      if (subject.length < 5) {
        throw new ValidationError('Konu en az 5 karakter olmalıdır.')
      }

      if (body.length < 10) {
        throw new ValidationError('Mesaj en az 10 karakter olmalıdır.')
      }

      let orderId: string | null = null
      if (params.orderId?.trim()) {
        const order = await assertSellerOrderOwnership(params.orderId.trim(), params.sellerId)
        orderId = order.id
      }

      const now = new Date()
      const attachmentAssetIds = await assertReadyAttachments(
        params.attachmentAssetIds ?? [],
        params.authorId,
      )
      const ticket = await prisma.$transaction(async (tx) => {
        const createdTicket = await tx.supportTicket.create({
          data: {
            sellerId: params.sellerId,
            orderId,
            subject,
            status: 'waiting_for_admin',
            lastSellerMessageAt: now,
          },
        })

        const message = await tx.supportMessage.create({
          data: {
            ticketId: createdTicket.id,
            authorId: params.authorId,
            authorRole: 'seller',
            body,
          },
        })

        if (attachmentAssetIds.length > 0) {
          await tx.mediaAsset.updateMany({
            where: { id: { in: attachmentAssetIds } },
            data: { type: 'support_attachment' },
          })
          await tx.supportMessageAttachment.createMany({
            data: attachmentAssetIds.map((mediaAssetId) => ({
              messageId: message.id,
              mediaAssetId,
            })),
            skipDuplicates: true,
          })
        }

        return createdTicket
      })

      await notifyAdminsAboutNewTicket({
        ticketId: ticket.id,
        sellerId: params.sellerId,
        sellerName: seller.displayName,
        subject,
        orderId,
      })

      return ticket
    },

    async addSellerMessage(params: {
      ticketId: string
      sellerId: string
      authorId: string
      body: string
      attachmentAssetIds?: string[]
    }) {
      const ticket = await prisma.supportTicket.findFirst({
        where: { id: params.ticketId, sellerId: params.sellerId },
        include: {
          seller: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      })

      if (!ticket || ticket.seller.userId !== params.authorId) {
        throw new ForbiddenError('Bu destek talebine mesaj gönderme yetkiniz yok.')
      }

      const body = params.body.trim()
      if (body.length < 2) {
        throw new ValidationError('Mesaj boş olamaz.')
      }

      const now = new Date()
      const attachmentAssetIds = await assertReadyAttachments(
        params.attachmentAssetIds ?? [],
        params.authorId,
      )
      await prisma.$transaction(async (tx) => {
        const message = await tx.supportMessage.create({
          data: {
            ticketId: ticket.id,
            authorId: params.authorId,
            authorRole: 'seller',
            body,
          },
        })

        if (attachmentAssetIds.length > 0) {
          await tx.mediaAsset.updateMany({
            where: { id: { in: attachmentAssetIds } },
            data: { type: 'support_attachment' },
          })
          await tx.supportMessageAttachment.createMany({
            data: attachmentAssetIds.map((mediaAssetId) => ({
              messageId: message.id,
              mediaAssetId,
            })),
            skipDuplicates: true,
          })
        }

        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status: 'waiting_for_admin',
            resolvedAt: null,
            lastSellerMessageAt: now,
          },
        })
      })

      return getTicketForSeller(ticket.id, params.sellerId)
    },

    listForAdmin() {
      return prisma.supportTicket.findMany({
        include: {
          seller: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
          order: {
            select: { id: true, status: true, createdAt: true },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              author: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      })
    },

    getForAdmin(ticketId: string) {
      return getTicketForAdmin(ticketId)
    },

    async addAdminMessage(params: {
      ticketId: string
      adminId: string
      body: string
      attachmentAssetIds?: string[]
    }) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: params.ticketId },
        include: {
          seller: {
            include: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      })

      if (!ticket) {
        throw new NotFoundError('Destek talebi', params.ticketId)
      }

      const body = params.body.trim()
      if (body.length < 2) {
        throw new ValidationError('Mesaj boş olamaz.')
      }

      const now = new Date()
      const attachmentAssetIds = await assertReadyAttachments(
        params.attachmentAssetIds ?? [],
        params.adminId,
      )
      await prisma.$transaction(async (tx) => {
        const message = await tx.supportMessage.create({
          data: {
            ticketId: ticket.id,
            authorId: params.adminId,
            authorRole: 'admin',
            body,
          },
        })

        if (attachmentAssetIds.length > 0) {
          await tx.mediaAsset.updateMany({
            where: { id: { in: attachmentAssetIds } },
            data: { type: 'support_attachment' },
          })
          await tx.supportMessageAttachment.createMany({
            data: attachmentAssetIds.map((mediaAssetId) => ({
              messageId: message.id,
              mediaAssetId,
            })),
            skipDuplicates: true,
          })
        }

        await tx.supportTicket.update({
          where: { id: ticket.id },
          data: {
            status: 'waiting_for_seller',
            resolvedAt: null,
            lastAdminMessageAt: now,
          },
        })
      })

      await notifications.send({
        userId: ticket.seller.user.id,
        type: 'seller_support_reply',
        title: 'Destek talebiniz yanıtlandı',
        body: `"${ticket.subject}" başlıklı destek talebinize yanıt verildi.`,
        data: { ticketId: ticket.id },
      })

      return getTicketForAdmin(ticket.id)
    },

    async resolveAsAdmin(params: { ticketId: string; adminId: string }) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: params.ticketId },
      })

      if (!ticket) {
        throw new NotFoundError('Destek talebi', params.ticketId)
      }

      return prisma.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
        },
      })
    },
  }
}

export type SupportTicketService = ReturnType<typeof createSupportTicketService>
