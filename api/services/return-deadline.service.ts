import type { PrismaClient } from '@prisma/client'
import { ValidationError } from '../lib/errors'
import { recordNotification } from './notification-outbox.service'

export function refundDeadline(receivedAt: Date) {
  return new Date(receivedAt.getTime() + 14 * 86_400_000)
}

/** Staff records verified carrier receipt; subsequent inspection never restarts this clock. */
export async function recordReturnCarrierReceipt(prisma: PrismaClient, id: string, receivedAt: Date, adminId: string) {
  if (!Number.isFinite(receivedAt.getTime()) || receivedAt > new Date()) throw new ValidationError('Geçerli, gelecekte olmayan teslim tarihi gerekli.')
  return prisma.$transaction(async (tx) => {
    const request = await tx.returnRequest.findUniqueOrThrow({ where: { id } })
    const proposed = refundDeadline(receivedAt)
    const deadline = request.refundDeadlineAt && request.refundDeadlineAt < proposed ? request.refundDeadlineAt : proposed
    const updated = await tx.returnRequest.update({ where: { id }, data: { returnCarrierDeliveredAt: receivedAt, refundDeadlineAt: deadline } })
    await tx.adminAuditLog.create({ data: { actorId: adminId, actionType: 'return_approved', targetType: 'return_request', targetId: id, newData: { operation: 'carrier_receipt', receivedAt: receivedAt.toISOString(), deadline: deadline.toISOString() } } })
    return updated
  })
}

/** Durable outbox keys produce one approaching and one overdue notification per deadline. */
export async function sweepReturnDeadlines(prisma: PrismaClient, now = new Date()) {
  const requests = await prisma.returnRequest.findMany({
    where: { refundDeadlineAt: { lte: new Date(now.getTime() + 2 * 86_400_000) }, status: { not: 'refund_completed' }, refundedAt: null },
    select: { id: true, orderId: true, refundDeadlineAt: true, escalatedDispute: { select: { status: true } } },
    orderBy: { refundDeadlineAt: 'asc' }, take: 500,
  })
  const admins = await prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } })
  for (const request of requests) {
    if (request.escalatedDispute?.status === 'resolved_for_seller') continue
    const stage = request.refundDeadlineAt! <= now ? 'overdue' : 'approaching'
    await prisma.$transaction(async (tx) => {
      for (const admin of admins) await recordNotification(tx, {
        eventKey: `return:${request.id}:deadline:${request.refundDeadlineAt!.toISOString()}:${stage}:${admin.id}`,
        userId: admin.id, type: 'admin_return_requested',
        title: stage === 'overdue' ? 'İade ödeme süresi geçti' : 'İade ödeme süresi yaklaşıyor',
        body: `İadenin ödeme son tarihi: ${request.refundDeadlineAt!.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}`,
        data: { returnRequestId: request.id, orderId: request.orderId, adminUrl: `/iadeler/${request.id}` },
      })
    })
  }
  return { checked: requests.length }
}
