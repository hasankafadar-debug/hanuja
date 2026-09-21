import type { Prisma, PrismaClient } from '@prisma/client'
import {
  getOverdueSellerApproval,
  SELLER_APPROVAL_EXCLUDED_STATUSES,
  SELLER_APPROVAL_WAIT_MS,
} from '../domain/seller-approval-overdue'

/** Shared source for the dashboard counter, admin list and CSV filter. */
export function createSellerApprovalQueryService({ prisma }: { prisma: PrismaClient }) {
  return {
    async listOverdueForAdmin({ now = new Date() }: { now?: Date } = {}) {
      const cutoff = new Date(now.getTime() - SELLER_APPROVAL_WAIT_MS)
      const where: Prisma.OrderWhereInput = {
        cancelledAt: null,
        status: { notIn: SELLER_APPROVAL_EXCLUDED_STATUSES },
        AND: [
          { OR: [
            { sellerQueueReadyAt: { lte: cutoff } },
            { sellerQueueReadyAt: null, paymentConfirmedAt: { lte: cutoff } },
          ] },
          { OR: [
            {
              quantityLifecycleVersion: 2,
              sellerFulfillments: { some: {
                status: { in: ['queue_ready', 'reviewing'] }, acceptedAt: null,
              } },
            },
            {
              quantityLifecycleVersion: { not: 2 },
              status: { in: ['seller_queue_ready', 'seller_reviewing'] },
            },
          ] },
        ],
      }
      const candidates = await prisma.order.findMany({
        where,
        select: {
          id: true, status: true, quantityLifecycleVersion: true,
          sellerQueueReadyAt: true, paymentConfirmedAt: true, cancelledAt: true,
          lines: { select: {
            sellerId: true, quantity: true, cancelledQuantity: true, shippedQuantity: true,
          } },
          sellerFulfillments: { select: { sellerId: true, status: true, acceptedAt: true } },
        },
      })
      // Match remaining quantities to the SAME seller; independent relation filters
      // would incorrectly count a cancelled seller alongside another seller's items.
      const rows = candidates.flatMap((order) => {
        const overdue = getOverdueSellerApproval(order, now)
        return overdue ? [overdue] : []
      }).sort((a, b) => a.waitingSince.getTime() - b.waitingSince.getTime() ||
        a.orderId.localeCompare(b.orderId))
      return { total: rows.length, rows }
    },
  }
}
