import type { LedgerEntryType, PrismaClient } from '@prisma/client'
import type { Decimal } from '@prisma/client/runtime/client'

export function createSellerLedgerRepository(prisma: PrismaClient) {
  return {
    /**
     * Append a new ledger entry — ledger is append-only, never update/delete.
     */
    createEntry(data: {
      sellerId: string
      type: LedgerEntryType
      amount: Decimal
      orderId?: string
      payoutId?: string
      penaltyId?: string
      note?: string
      createdBy?: string
    }) {
      // exactOptionalPropertyTypes: filter undefined values before Prisma create
      const payload: Record<string, unknown> = {
        sellerId: data.sellerId,
        type: data.type,
        amount: data.amount,
      }
      if (data.orderId !== undefined) payload.orderId = data.orderId
      if (data.payoutId !== undefined) payload.payoutId = data.payoutId
      if (data.penaltyId !== undefined) payload.penaltyId = data.penaltyId
      if (data.note !== undefined) payload.note = data.note
      if (data.createdBy !== undefined) payload.createdBy = data.createdBy
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return prisma.sellerLedgerEntry.create({ data: payload as any })
    },

    /**
     * Sum all ledger entries for a seller to compute current balance.
     * Credits are positive, debits are negative amounts.
     */
    async computeBalance(
      sellerId: string,
    ): Promise<{ balance: Decimal; entries: number }> {
      const result = await prisma.sellerLedgerEntry.aggregate({
        where: { sellerId },
        _sum: { amount: true },
        _count: { id: true },
      })
      return {
        balance: result._sum.amount ?? (0 as unknown as Decimal),
        entries: result._count.id,
      }
    },

    listBySeller(params: {
      sellerId: string
      type?: LedgerEntryType
      skip?: number
      take?: number
    }) {
      return prisma.sellerLedgerEntry.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.type !== undefined ? { type: params.type } : {}),
        },
        orderBy: { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 30,
      })
    },

    countBySeller(sellerId: string) {
      return prisma.sellerLedgerEntry.count({ where: { sellerId } })
    },
  }
}

export type SellerLedgerRepository = ReturnType<typeof createSellerLedgerRepository>
