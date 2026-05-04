import type { PrismaClient } from '@prisma/client'
import { createSellerLedgerRepository } from '../repositories/seller-ledger.repository'
import {
  type SellerStatementRow,
  getSellerStatementDescription,
  getSellerStatementTopic,
} from '../domain/seller-statement'

interface SellerFinanceServiceDeps {
  prisma: PrismaClient
}

function formatShortOrderReference(orderId: string) {
  return `#${orderId.slice(-8).toUpperCase()}`
}

function formatStatementDate(date: Date) {
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

function formatStatementAmount(value: number) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
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
        ledger.getOpeningBalance(params.sellerId, params.from),
        prisma.sellerLedgerEntry.findMany({
          where: {
            sellerId: params.sellerId,
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
          ? formatShortOrderReference(orderId)
          : `${entry.referenceType}:${entry.referenceId.slice(-8).toUpperCase()}`

        return {
          id: entry.id,
          date: entry.createdAt,
          reference,
          topic: getSellerStatementTopic(entry.type),
          description: getSellerStatementDescription(entry.type),
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
      openingBalance: number
      rows: SellerStatementRow[]
    }) {
      const lines = [
        ['Tarih', 'Referans', 'Konu', 'Aciklama', 'Alacak', 'Borc', 'Bakiye']
          .map(escapeCsvCell)
          .join(';'),
        [
          escapeCsvCell(formatStatementDate(new Date())),
          escapeCsvCell('-'),
          escapeCsvCell('Devir'),
          escapeCsvCell('Donem basi bakiyesi'),
          escapeCsvCell(params.openingBalance >= 0 ? formatStatementAmount(params.openingBalance) : ''),
          escapeCsvCell(params.openingBalance < 0 ? formatStatementAmount(Math.abs(params.openingBalance)) : ''),
          escapeCsvCell(formatStatementAmount(params.openingBalance)),
        ].join(';'),
        ...params.rows.map((row) =>
          [
            escapeCsvCell(formatStatementDate(row.date)),
            escapeCsvCell(row.reference),
            escapeCsvCell(row.topic),
            escapeCsvCell(row.description),
            escapeCsvCell(row.credit > 0 ? formatStatementAmount(row.credit) : ''),
            escapeCsvCell(row.debit > 0 ? formatStatementAmount(row.debit) : ''),
            escapeCsvCell(formatStatementAmount(row.balance)),
          ].join(';'),
        ),
      ]

      return `\uFEFF${lines.join('\r\n')}`
    },
  }
}

export type SellerFinanceService = ReturnType<typeof createSellerFinanceService>
