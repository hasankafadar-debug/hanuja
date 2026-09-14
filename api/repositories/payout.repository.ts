import { Prisma, type PayoutStatus, type PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createPayoutRepository(prisma: PrismaClient | Prisma.TransactionClient) {
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

    /**
     * Seller-scoped payout detail — used by the seller panel payout detail
     * screen (/odemeler/[id]). Ownership is enforced via the `sellerId` where
     * clause (server-side; 09-seller-panel-rules.md — sellers see only their
     * own finance data). Returns null if the payout does not exist or does not
     * belong to this seller — callers must translate that into 404, never leak
     * existence of another seller's payout.
     */
    findByIdForSeller(id: string, sellerId: string) {
      return prisma.payout.findFirst({
        where: { id, sellerId },
        include: {
          order: {
            select: {
              id: true,
              publicNumber: true,
              createdAt: true,
              deliveryConfirmedAt: true,
              lines: {
                where: { sellerId },
                select: {
                  id: true,
                  productName: true,
                  variantName: true,
                  quantity: true,
                  unitPrice: true,
                  totalPrice: true,
                  couponDiscountAmount: true,
                  commissionRate: true,
                  commissionAmount: true,
                  netPayoutAmount: true,
                  commissionExemptedAt: true,
                },
              },
            },
          },
        },
      })
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
          ...(data.transferReference !== undefined
            ? { transferReference: data.transferReference }
            : {}),
          ...(data.transferBankName !== undefined
            ? { transferBankName: data.transferBankName }
            : {}),
          ...(data.transferNote !== undefined ? { transferNote: data.transferNote } : {}),
          ...(data.ibanSnapshot !== undefined ? { ibanSnapshot: data.ibanSnapshot } : {}),
          ...(data.accountHolderSnapshot !== undefined
            ? { accountHolderSnapshot: data.accountHolderSnapshot }
            : {}),
          ...(data.bankDetailId !== undefined ? { bankDetailId: data.bankDetailId } : {}),
        },
      })
    },

    /** Missing seller payouts or accruals, including partially created orders. */
    findDeliveryConfirmedOrdersMissingPayout() {
      return prisma.$queryRaw<
        Array<{
          id: string
          publicNumber: number | null
          deliveryConfirmedAt: Date
          updatedAt: Date
        }>
      >(Prisma.sql`
        SELECT o.id, o."publicNumber", o."deliveryConfirmedAt", o."updatedAt"
        FROM orders o
        WHERE o.status = 'delivery_confirmed' AND o."deliveryConfirmedAt" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM order_lines l
          LEFT JOIN payouts p ON p."orderId" = o.id AND p."sellerId" = l."sellerId"
          WHERE l."orderId" = o.id AND (
            p.id IS NULL
            OR ((p."commissionAmount" > 0 OR EXISTS (
              SELECT 1 FROM seller_ledger_entries reversal
              JOIN refund_transactions r ON r.id = reversal."referenceId"
              WHERE r."orderId" = o.id AND r."sellerId" = l."sellerId"
                AND reversal."sellerId" = l."sellerId"
                AND reversal.type = 'commission' AND reversal.amount > 0
                AND reversal."referenceType" = 'refund_transaction'
            )) AND NOT EXISTS (
              SELECT 1 FROM seller_ledger_entries e
              WHERE e."sellerId" = l."sellerId" AND e.type = 'commission'
                AND e."referenceType" = 'payout' AND e."referenceId" = p.id
            ))
            OR NOT EXISTS (
              SELECT 1 FROM seller_ledger_entries e
              WHERE e."sellerId" = l."sellerId" AND e.type = 'sale'
                AND e."referenceType" = 'order' AND e."referenceId" = o.id
            )
            OR (l."couponDiscountAmount" > 0 AND NOT EXISTS (
              SELECT 1 FROM seller_ledger_entries e
              WHERE e."sellerId" = l."sellerId" AND e.type = 'coupon_share'
                AND e."referenceType" = 'order' AND e."referenceId" = o.id
            ))
          )
        )
        ORDER BY o."deliveryConfirmedAt", o.id
      `)
    },

    /** Find payouts where hold period has expired and no blocking issues */
    findReadyForRelease(now = new Date()) {
      return prisma.payout.findMany({
        where: {
          status: { in: ['hold_active', 'payout_blocked', 'payout_ready', 'payout_scheduled'] },
          holdUntil: { lte: now },
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
