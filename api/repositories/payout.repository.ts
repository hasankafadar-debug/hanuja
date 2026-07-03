import type { PayoutStatus, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createPayoutRepository(prisma: PrismaClient) {
  return {
    findById(id: string) {
      return prisma.payout.findUnique({ where: { id } })
    },

    findByOrderId(orderId: string) {
      return prisma.payout.findFirst({ where: { orderId } })
    },

    findManyByOrderId(orderId: string) {
      return prisma.payout.findMany({ where: { orderId } })
    },

    create(
      data: {
        sellerId: string
        orderId: string
        grossAmount: Decimal
        commissionAmount: Decimal
        couponShareAmount: Decimal
        cargoChargeAmount: Decimal
        adFeeAmount: Decimal
        penaltyAmount: Decimal
        refundAmount: Decimal
        adjustmentAmount: Decimal
        netAmount: Decimal
        holdStartedAt?: Date
        holdUntil?: Date
        bankDetailId?: string
      },
      tx?: PrismaClient,
    ) {
      const client = tx ?? prisma
      return client.payout.create({ data })
    },

    updateStatus(id: string, status: PayoutStatus, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.payout.update({ where: { id }, data: { status } })
    },

    block(id: string, reason: string) {
      return prisma.payout.update({
        where: { id },
        data: { status: 'payout_blocked', blockedReason: reason },
      })
    },

    markPaid(id: string, batchId?: string) {
      return prisma.payout.update({
        where: { id },
        data: {
          status: 'payout_paid',
          paidAt: new Date(),
          ...(batchId !== undefined ? { batchId } : {}),
        },
      })
    },

    markPaidWithTransfer(
      id: string,
      data: {
        batchId?: string
        transferReference?: string | null
        transferDate: Date
        transferBankName?: string | null
        transferNote?: string | null
        paidByAdminId: string
        ibanSnapshot?: string | null
        accountHolderSnapshot?: string | null
        bankDetailId?: string | null
      },
    ) {
      return prisma.payout.update({
        where: { id },
        data: {
          status: 'payout_paid',
          paidAt: new Date(),
          transferDate: data.transferDate,
          paidByAdminId: data.paidByAdminId,
          ...(data.batchId !== undefined ? { batchId: data.batchId } : {}),
          ...(data.transferReference !== undefined ? { transferReference: data.transferReference } : {}),
          ...(data.transferBankName !== undefined ? { transferBankName: data.transferBankName } : {}),
          ...(data.transferNote !== undefined ? { transferNote: data.transferNote } : {}),
          ...(data.ibanSnapshot !== undefined ? { ibanSnapshot: data.ibanSnapshot } : {}),
          ...(data.accountHolderSnapshot !== undefined ? { accountHolderSnapshot: data.accountHolderSnapshot } : {}),
          ...(data.bankDetailId !== undefined ? { bankDetailId: data.bankDetailId } : {}),
        },
      })
    },

    /** Find payouts where hold period has expired and no blocking issues */
    findReadyForRelease(now = new Date()) {
      return prisma.payout.findMany({
        where: {
          status: 'hold_active',
          holdUntil: { lte: now },
          order: {
            returnRequests: { none: { status: { notIn: ['rejected', 'refund_completed'] } } },
            disputes: { none: { status: 'open' } },
          },
        },
        include: { seller: true, bankDetail: true },
      })
    },

    listBySeller(params: {
      sellerId: string
      status?: PayoutStatus
      skip?: number
      take?: number
    }) {
      return prisma.payout.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.status !== undefined ? { status: params.status } : {}),
        },
        include: {
          order: {
            select: {
              id: true,
              publicNumber: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    listForAdmin(params: {
      sellerId?: string
      status?: PayoutStatus
      holdUntilFrom?: Date
      holdUntilTo?: Date
      skip?: number
      take?: number
    }) {
      return prisma.payout.findMany({
        where: {
          ...(params.sellerId !== undefined ? { sellerId: params.sellerId } : {}),
          ...(params.status !== undefined ? { status: params.status } : {}),
          ...(params.holdUntilFrom !== undefined || params.holdUntilTo !== undefined
            ? {
                holdUntil: {
                  ...(params.holdUntilFrom !== undefined ? { gte: params.holdUntilFrom } : {}),
                  ...(params.holdUntilTo !== undefined ? { lte: params.holdUntilTo } : {}),
                },
              }
            : {}),
        },
        include: {
          seller: {
            include: {
              profile: true,
              bankDetails: {
                where: { isActive: true },
                orderBy: { updatedAt: 'desc' },
                take: 1,
              },
            },
          },
          bankDetail: true,
          order: {
            select: {
              id: true,
              publicNumber: true,
              createdAt: true,
              shippedAt: true,
              deliveryConfirmedAt: true,
              totalAmount: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 20,
      })
    },

    /** Summary totals for a seller */
    async getSummaryBySeller(sellerId: string) {
      const grouped = await prisma.payout.groupBy({
        by: ['status'],
        where: { sellerId },
        _sum: { netAmount: true },
      })
      return grouped
    },
  }
}

export type PayoutRepository = ReturnType<typeof createPayoutRepository>
