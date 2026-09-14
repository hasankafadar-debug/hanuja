import type { PrismaClient } from '@prisma/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { lockSellerFinance } from '../lib/seller-finance-lock'

export function createCommissionExemptionService({ prisma }: { prisma: PrismaClient }) {
  return {
    async exempt(params: { orderLineId: string; adminActorId: string; reason: string }) {
      const owner = await prisma.orderLine.findUnique({
        where: { id: params.orderLineId },
        select: { sellerId: true },
      })
      if (!owner) throw new NotFoundError('OrderLine', params.orderLineId)
      return prisma.$transaction(async (tx) => {
        await lockSellerFinance(tx, [owner.sellerId])
        const line = await tx.orderLine.findUnique({
          where: { id: params.orderLineId },
        })
        if (!line) throw new NotFoundError('OrderLine', params.orderLineId)
        if (line.commissionInvoiceId) {
          throw new ValidationError('Bu satır zaten faturalandırılmış, muaf tutulamaz.')
        }
        if (line.commissionExemptedAt) {
          throw new ValidationError('Bu satır zaten muaf tutulmuş.')
        }
        const payout = await tx.payout.findFirst({
          where: { orderId: line.orderId, sellerId: line.sellerId },
          select: { id: true },
        })
        if (payout) {
          throw new ConflictError(
            'Hakediş kaydı oluşturulmuş siparişte komisyon muafiyeti uygulanamaz',
          )
        }
        return tx.orderLine.update({
          where: { id: line.id },
          data: {
            commissionExemptedAt: new Date(),
            commissionExemptedBy: params.adminActorId,
            commissionExemptedReason: params.reason,
          },
        })
      })
    },
  }
}
