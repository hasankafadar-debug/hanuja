import type { SellerStatementRow } from '@hanuja/api/domain/seller-statement'
import { Button } from '@hanuja/ui'
import { Download } from 'lucide-react'

interface Props {
  from: Date
  fromInput: string
  toInput: string
  exportHref: string
  statement: {
    openingBalance: number
    closingBalance: number
    rows: SellerStatementRow[]
  }
}

function formatCurrency(value: number) {
  const formatted = value.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatted} TL`
}

export function SellerAccountStatement({ from, fromInput, toInput, exportHref, statement }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
            Hesap Ekstresi
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Seçili tarih aralığındaki resmi hesap hareketleri.
          </p>
        </div>

        <a href={exportHref}>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4" />
            Excel indir
          </Button>
        </a>
      </div>

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
