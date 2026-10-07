import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError, NotFoundError } from '../lib/errors'
import { SELLER_VISIBLE_PAYMENT_WHERE } from '../repositories/order.repository'
import { DELIVERY_REVIEW_STATUSES, isDeliveryReviewLine } from '../domain/delivery-review'

export function createSellerDeliveryReportService({ prisma }: { prisma: PrismaClient }) {
  return {
    async report(params: { orderId: string; sellerId: string; actorId: string }) {
      return prisma.$transaction(async (tx) => {
        // Shared with definitive confirmation: stale clicks cannot overwrite a teyit.
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM orders WHERE id = ${params.orderId} FOR UPDATE`,
        )
        const order = await tx.order.findFirst({
          where: {
            id: params.orderId,
            lines: { some: { sellerId: params.sellerId } },
            AND: [SELLER_VISIBLE_PAYMENT_WHERE],
          },
          select: {
            status: true,
            quantityLifecycleVersion: true,
            lines: {
              where: { sellerId: params.sellerId },
              select: {
                id: true,
                quantity: true,
                cancelledQuantity: true,
                shippedQuantity: true,
                fulfilledAt: true,
                deliveryConfirmedAt: true,
                sellerDeliveryReportedAt: true,
              },
            },
          },
        })
        if (!order) throw new NotFoundError('Sipariş', params.orderId)
        if (!(DELIVERY_REVIEW_STATUSES as readonly string[]).includes(order.status)) {
          throw new ConflictError('Bu sipariş için teslim bildirimi yapılamaz')
        }
        const pending = order.lines.filter((line) =>
          isDeliveryReviewLine(line, order.quantityLifecycleVersion),
        )
        if (pending.length === 0) {
          throw new ConflictError('Teslim bildirimi yapılabilecek sevk edilmiş ürün bulunamadı')
        }
        const newIds = pending
          .filter((line) => !line.sellerDeliveryReportedAt)
          .map((line) => line.id)
        const now = new Date()
        if (newIds.length > 0) {
          await tx.orderLine.updateMany({
            where: {
              id: { in: newIds },
              sellerId: params.sellerId,
              deliveryConfirmedAt: null,
              sellerDeliveryReportedAt: null,
            },
            data: {
              sellerDeliveryReportedAt: now,
              sellerDeliveryReportedBy: params.actorId,
            },
          })
        }
        const reportedAt = pending.reduce((earliest, line) => {
          const date = line.sellerDeliveryReportedAt ?? now
          return date < earliest ? date : earliest
        }, now)
        return {
          orderId: params.orderId,
          reportedLineIds: pending.map((line) => line.id),
          reportedAt,
        }
      })
    },
  }
}
