import type { SellerStatementRow } from './seller-statement'
import { formatReportingDate } from '../lib/reporting-time'

export const SELLER_STATEMENT_EXPORT_HEADERS = [
  'Tarih',
  'Referans',
  'Konu',
  'Açıklama',
  'Alacak',
  'Borç',
  'Bakiye',
] as const

export type SellerStatementExportHeader = (typeof SELLER_STATEMENT_EXPORT_HEADERS)[number]

export type SellerStatementExportRow = Record<SellerStatementExportHeader, string>

export function formatSellerStatementDate(date: Date) {
  return formatReportingDate(date, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatSellerStatementAmount(value: number) {
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function buildSellerStatementExportRows(params: {
  from: Date
  openingBalance: number
  rows: SellerStatementRow[]
}): SellerStatementExportRow[] {
  return [
    {
      Tarih: formatSellerStatementDate(params.from),
      Referans: '-',
      Konu: 'Devir',
      Açıklama: 'Dönem başı bakiyesi',
      Alacak: params.openingBalance >= 0 ? formatSellerStatementAmount(params.openingBalance) : '',
      Borç: params.openingBalance < 0 ? formatSellerStatementAmount(Math.abs(params.openingBalance)) : '',
      Bakiye: formatSellerStatementAmount(params.openingBalance),
    },
    ...params.rows.map((row) => ({
      Tarih: formatSellerStatementDate(row.date),
      Referans: row.reference,
      Konu: row.topic,
      Açıklama: row.description,
      Alacak: row.credit > 0 ? formatSellerStatementAmount(row.credit) : '',
      Borç: row.debit > 0 ? formatSellerStatementAmount(row.debit) : '',
      Bakiye: formatSellerStatementAmount(row.balance),
    })),
  ]
}
