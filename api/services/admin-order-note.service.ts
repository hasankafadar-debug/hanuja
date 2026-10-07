import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { ForbiddenError, NotFoundError } from '../lib/errors'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'

export const adminOrderNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
})

export function createAdminOrderNoteService({ prisma }: { prisma: PrismaClient }) {
  return {
    async add(params: { orderId: string; authorId: string; body: string }) {
      const { body } = adminOrderNoteSchema.parse(params)
      return prisma.$transaction(async (tx) => {
        const author = await tx.user.findUnique({
          where: { id: params.authorId },
          select: { role: true },
        })
        if (author?.role !== 'admin') throw new ForbiddenError()
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          select: { id: true },
        })
        if (!order) throw new NotFoundError('Sipariş', params.orderId)
        const note = await tx.orderAdminNote.create({
          data: { orderId: params.orderId, authorId: params.authorId, body },
          select: { id: true, createdAt: true },
        })
        await createAdminAuditLogRepository(tx).createEntry({
          actorId: params.authorId,
          actionType: 'order_admin_note_added',
          targetType: 'order',
          targetId: params.orderId,
          newData: { noteId: note.id },
        })
        return note
      })
    },
  }
}
