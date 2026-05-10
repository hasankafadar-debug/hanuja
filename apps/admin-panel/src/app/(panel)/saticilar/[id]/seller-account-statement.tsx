type StatementItem = {
  id: string
  date: Date
  type: string
  description: string
  amount: number
  reference: string
}

function typeLabel(type: string) {
  const labels: Record<string, string> = {
    sale: 'Sale',
    commission: 'Commission',
    penalty: 'Penalty',
    payout: 'Payout',
    manual_adjustment: 'Adjustment',
    commission_invoice: 'Commission invoice',
    penalty_invoice: 'Penalty invoice',
  }
  return labels[type] ?? type
}

function amountColor(amount: number) {
  if (amount > 0) return 'var(--color-success)'
  if (amount < 0) return 'var(--color-destructive)'
  return 'var(--color-muted-fg)'
}

export function SellerAccountStatement({ items }: { items: StatementItem[] }) {
  if (items.length === 0) {
    return (
      <div
        className="rounded-xl border p-6 text-center text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-muted-fg)' }}
      >
        No account statement records found.
      </div>
    )
  }

  const income = items.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0)
  const deductions = items.filter((item) => item.amount < 0).reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const payouts = items.filter((item) => item.type === 'payout').reduce((sum, item) => sum + Math.abs(item.amount), 0)
  const balance = income - deductions

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { label: 'Period income', value: income },
          { label: 'Deductions', value: deductions },
          { label: 'Paid out', value: payouts },
          { label: 'Balance', value: balance },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>{stat.label}</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
              TRY {stat.value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Date', 'Type', 'Description', 'Reference', 'Amount'].map((heading) => (
                <th
                  key={heading}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                  {new Date(item.date).toLocaleDateString('tr-TR', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3">
                  <span
                    className="rounded-full px-2.5 py-1 text-xs font-medium"
                    style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-primary)' }}
                  >
                    {typeLabel(item.type)}
                  </span>
                </td>
                <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                  {item.description}
                </td>
                <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--color-muted-fg)' }}>
                  {item.reference}
                </td>
                <td className="px-4 py-3 font-medium" style={{ color: amountColor(item.amount) }}>
                  {item.amount < 0 ? '-' : '+'}TRY {Math.abs(item.amount).toLocaleString('tr-TR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
