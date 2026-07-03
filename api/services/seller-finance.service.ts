import type { PrismaClient } from '@prisma/client'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import {
  type SellerStatementRow,
  getSellerStatementDescription,
  getSellerStatementTopic,
} from '../domain/seller-statement'
import {
  buildSellerStatementExportRows,
  SELLER_STATEMENT_EXPORT_HEADERS,
  type SellerStatementExportRow,
} from '../domain/seller-statement-export'
import { formatOrderDisplayNumber } from '../lib/order-number'

interface SellerFinanceServiceDeps {
  prisma: PrismaClient
}

function escapeCsvCell(value: string) {
  const normalized = value.replace(/"/g, '""')
  return `"${normalized}"`
}

export function createSellerFinanceService({ prisma }: SellerFinanceServiceDeps) {
  const ledger = createSellerLedgerRepository(prisma)

  return {
    async getStatement(params: {
      sellerId: string
      from: Date
      to: Date
    }): Promise<{
      openingBalance: number
      closingBalance: number
      rows: SellerStatementRow[]
    }> {
      const [openingBalanceRaw, entries] = await Promise.all([
        ledger.getOpeningBalance(params.sellerId, params.from, { visibleToSeller: true }),
        prisma.sellerLedgerEntry.findMany({
          where: {
            sellerId: params.sellerId,
            visibleToSeller: true,
            createdAt: {
              gte: params.from,
              lte: params.to,
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      ])

      const payoutIds = entries
        .filter((entry) => entry.referenceType === 'payout')
        .map((entry) => entry.referenceId)
      const penaltyIds = entries
        .filter((entry) => entry.referenceType === 'penalty')
        .map((entry) => entry.referenceId)

      const [payoutRefs, penaltyRefs] = await Promise.all([
        payoutIds.length
          ? prisma.payout.findMany({
              where: { id: { in: payoutIds } },
              select: { id: true, orderId: true },
            })
          : Promise.resolve([]),
        penaltyIds.length
          ? prisma.penalty.findMany({
              where: { id: { in: penaltyIds } },
              select: { id: true, orderId: true },
            })
          : Promise.resolve([]),
      ])

      const payoutOrderMap = new Map(payoutRefs.map((item) => [item.id, item.orderId]))
      const penaltyOrderMap = new Map(penaltyRefs.map((item) => [item.id, item.orderId]))

      // Collect all order IDs referenced by entries so we can show publicNumber
      const allOrderIds = new Set<string>()
      for (const entry of entries) {
        const orderId =
          entry.referenceType === 'order'
            ? entry.referenceId
            : entry.referenceType === 'payout'
              ? payoutOrderMap.get(entry.referenceId)
              : entry.referenceType === 'penalty'
                ? penaltyOrderMap.get(entry.referenceId)
                : undefined
        if (orderId) allOrderIds.add(orderId)
      }

      const orderPublicNumberMap = new Map<string, number | null>()
      if (allOrderIds.size > 0) {
        const orderRows = await prisma.order.findMany({
          where: { id: { in: [...allOrderIds] } },
          select: { id: true, publicNumber: true },
        })
        for (const row of orderRows) {
          orderPublicNumberMap.set(row.id, row.publicNumber)
        }
      }

      let runningBalance = Number(
        typeof openingBalanceRaw === 'object' && 'toNumber' in openingBalanceRaw
          ? openingBalanceRaw.toNumber()
          : openingBalanceRaw,
      )

      const rows = entries.map<SellerStatementRow>((entry) => {
        const amount = Number(
          typeof entry.amount === 'object' && 'toNumber' in entry.amount
            ? entry.amount.toNumber()
            : entry.amount,
        )
        runningBalance += amount

        const orderId =
          entry.referenceType === 'order'
            ? entry.referenceId
            : entry.referenceType === 'payout'
              ? payoutOrderMap.get(entry.referenceId)
              : entry.referenceType === 'penalty'
                ? penaltyOrderMap.get(entry.referenceId)
                : undefined

        const reference = orderId
          ? formatOrderDisplayNumber(orderPublicNumberMap.get(orderId), orderId)
          : `${entry.referenceType}:${entry.referenceId.slice(-8).toUpperCase()}`

        return {
          id: entry.id,
          date: entry.createdAt,
          reference,
          topic: getSellerStatementTopic(entry.type),
          description: entry.description?.trim() || getSellerStatementDescription(entry.type),
          credit: amount > 0 ? amount : 0,
          debit: amount < 0 ? Math.abs(amount) : 0,
          balance: runningBalance,
        }
      })

      return {
        openingBalance: Number(
          typeof openingBalanceRaw === 'object' && 'toNumber' in openingBalanceRaw
            ? openingBalanceRaw.toNumber()
            : openingBalanceRaw,
        ),
        closingBalance: runningBalance,
        rows,
      }
    },

    buildStatementCsv(params: {
      from: Date
      openingBalance: number
      rows: SellerStatementRow[]
    }) {
      const exportRows = buildSellerStatementExportRows({
        from: params.from,
        openingBalance: params.openingBalance,
        rows: params.rows,
      })
      const lines = [
        [...SELLER_STATEMENT_EXPORT_HEADERS]
          .map(escapeCsvCell)
          .join(';'),
        ...exportRows.map((row) =>
          SELLER_STATEMENT_EXPORT_HEADERS.map((header) => escapeCsvCell(row[header])).join(';'),
        ),
      ]

      return `\uFEFF${lines.join('\r\n')}`
    },

    buildStatementExportRows(params: {
      from: Date
      openingBalance: number
      rows: SellerStatementRow[]
    }): SellerStatementExportRow[] {
      return buildSellerStatementExportRows(params)
    },
  }
}

export type SellerFinanceService = ReturnType<typeof createSellerFinanceService>
