import type { LedgerEntryType, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

type DecimalLike = Decimal | number | string | null | undefined

export function coerceDecimal(value: DecimalLike): Decimal {
  if (value instanceof Decimal) return value
  if (value === null || value === undefined) return new Decimal(0)
  return new Decimal(value)
}

export function createSellerLedgerRepository(prisma: PrismaClient) {
  return {
    /**
     * Append a new ledger entry — ledger is append-only, never update/delete.
     */
    createEntry(data: {
      sellerId: string
      type: LedgerEntryType
      amount: Decimal
      referenceType?: string
      referenceId?: string
      description?: string
      orderId?: string
      payoutId?: string
      penaltyId?: string
      note?: string
      createdBy?: string
      visibleToSeller?: boolean
    }, tx?: PrismaClient) {
      const client = tx ?? prisma
      return client.sellerLedgerEntry.aggregate({
        where: { sellerId: data.sellerId },
        _sum: { amount: true },
      }).then((result) => {
        const previousBalance = coerceDecimal(result._sum.amount)
        const balanceAfter = previousBalance.plus(coerceDecimal(data.amount))
        const referenceType =
          data.referenceType ??
          (data.orderId ? 'order' : data.payoutId ? 'payout' : data.penaltyId ? 'penalty' : 'manual')
        const referenceId = data.referenceId ?? data.orderId ?? data.payoutId ?? data.penaltyId ?? 'manual'
        const description = data.description ?? data.note

        return client.sellerLedgerEntry.create({
          data: {
            sellerId: data.sellerId,
            type: data.type,
            amount: data.amount,
            balanceAfter,
            referenceType,
            referenceId,
            ...(description !== undefined ? { description } : {}),
            ...(data.createdBy !== undefined ? { createdBy: data.createdBy } : {}),
            ...(data.visibleToSeller !== undefined ? { visibleToSeller: data.visibleToSeller } : {}),
          },
        })
      })
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
        balance: coerceDecimal(result._sum.amount),
        entries: result._count.id,
      }
    },

    listBySeller(params: {
      sellerId: string
      type?: LedgerEntryType
      from?: Date
      to?: Date
      skip?: number
      take?: number
      visibleToSeller?: boolean
    }) {
      return prisma.sellerLedgerEntry.findMany({
        where: {
          sellerId: params.sellerId,
          ...(params.type !== undefined ? { type: params.type } : {}),
          ...(params.visibleToSeller !== undefined ? { visibleToSeller: params.visibleToSeller } : {}),
          ...((params.from !== undefined || params.to !== undefined)
            ? {
                createdAt: {
                  ...(params.from !== undefined ? { gte: params.from } : {}),
                  ...(params.to !== undefined ? { lte: params.to } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        take: params.take ?? 30,
      })
    },

    async getOpeningBalance(sellerId: string, before: Date, options?: { visibleToSeller?: boolean }) {
      const result = await prisma.sellerLedgerEntry.aggregate({
        where: {
          sellerId,
          createdAt: { lt: before },
          ...(options?.visibleToSeller !== undefined
            ? { visibleToSeller: options.visibleToSeller }
            : {}),
        },
        _sum: { amount: true },
      })

      return coerceDecimal(result._sum.amount)
    },

    async getPenaltyDeducted(sellerId: string) {
      const result = await prisma.sellerLedgerEntry.aggregate({
        where: {
          sellerId,
          OR: [
            { type: 'penalty' },
            { referenceType: 'penalty' },
          ],
        },
        _sum: { amount: true },
      })

      const total = coerceDecimal(result._sum?.amount)
      return total.lessThan(0) ? total.negated() : total
    },

    findByReference(params: {
      sellerId: string
      type?: LedgerEntryType
      referenceType: string
      referenceId: string
    }) {
      return prisma.sellerLedgerEntry.findFirst({
        where: {
          sellerId: params.sellerId,
          referenceType: params.referenceType,
          referenceId: params.referenceId,
          ...(params.type !== undefined ? { type: params.type } : {}),
        },
      })
    },

    countBySeller(sellerId: string) {
      return prisma.sellerLedgerEntry.count({ where: { sellerId } })
    },
  }
}

export type SellerLedgerRepository = ReturnType<typeof createSellerLedgerRepository>
