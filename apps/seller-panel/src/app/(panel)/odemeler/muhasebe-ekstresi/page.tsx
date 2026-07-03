import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, PageHeader } from '@hanuja/ui'
import { Download } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSellerFinanceService } from '@hanuja/api/services/seller-finance.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Muhasebe Ekstresi' }

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

function formatDateInput(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatCurrency(value: number) {
  const formatted = value.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatted} TL`
}

export default async function SellerStatementPage({ searchParams }: Props) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const { seller } = await getSellerFromSession()
  const service = createSellerFinanceService({ prisma: createPrismaForRoute() })

  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const defaultFrom = new Date(defaultTo)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  defaultFrom.setUTCHours(0, 0, 0, 0)

  const fromInput = getSingleValue(resolvedSearchParams.from) ?? formatDateInput(defaultFrom)
  const toInput = getSingleValue(resolvedSearchParams.to) ?? formatDateInput(defaultTo)
  const from = new Date(`${fromInput}T00:00:00.000Z`)
  const to = new Date(`${toInput}T23:59:59.999Z`)

  const statement = await service.getStatement({
    sellerId: seller.id,
    from,
    to,
  })

  const exportHref = `/api/seller/finance/statement?from=${fromInput}&to=${toInput}&format=xlsx`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Muhasebe Ekstresi"
        description="Belirli tarih aralığında hesap hareketlerinizi inceleyin."
        actions={
          <Link href={exportHref}>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              Excel indir
            </Button>
          </Link>
        }
      />

      <form
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr,1fr,auto]"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <input
          id="statement-from"
          type="date"
          name="from"
          aria-label="Başlangıç tarihi"
          defaultValue={fromInput}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <input
          id="statement-to"
          type="date"
          name="to"
          aria-label="Bitiş tarihi"
          defaultValue={toInput}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <Button type="submit" size="sm">
          Filtreyi uygula
        </Button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Devir Bakiyesi', value: statement.openingBalance, currency: true },
          { label: 'Dönem Sonu Bakiyesi', value: statement.closingBalance, currency: true },
          { label: 'Hareket Sayısı', value: statement.rows.length, currency: false },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              {item.label}
            </p>
            <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--color-primary)' }}>
              {item.currency ? formatCurrency(Number(item.value)) : item.value}
            </p>
          </div>
        ))}
      </div>

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Tarih', 'Referans', 'Konu', 'Açıklama', 'Alacak', 'Borç', 'Bakiye'].map((header) => (
                <th
                  key={header}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t" style={{ borderColor: 'var(--color-border)' }}>
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {from.toLocaleDateString('tr-TR')}
              </td>
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                -
              </td>
              <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                Devir
              </td>
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Dönem başı bakiyesi
              </td>
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {statement.openingBalance > 0 ? formatCurrency(statement.openingBalance) : '-'}
              </td>
              <td className="px-4 py-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {statement.openingBalance < 0 ? formatCurrency(Math.abs(statement.openingBalance)) : '-'}
              </td>
              <td className="px-4 py-3 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                {formatCurrency(statement.openingBalance)}
              </td>
            </tr>
            {statement.rows.map((row) => (
              <tr key={row.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                  {new Date(row.date).toLocaleDateString('tr-TR')}
                </td>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                  {row.reference}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                  {row.topic}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                  {row.description}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-success)' }}>
                  {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-destructive)' }}>
                  {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                </td>
                <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                  {formatCurrency(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
