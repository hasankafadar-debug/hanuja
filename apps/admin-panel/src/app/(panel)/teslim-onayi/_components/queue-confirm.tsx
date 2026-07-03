'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type Row = {
  id: string
  productName: string
  quantity: number
  orderId: string
  orderNumber: string
  shippedAt: string
  status: string
  customerName: string
  sellerName: string
  cargoProvider: string
}

export function QueueConfirm({ lines }: { lines: Row[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Group lines by orderId so confirming dispatches a single POST per order.
  const groups = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const line of lines) {
      const list = map.get(line.orderId) ?? []
      list.push(line)
      map.set(line.orderId, list)
    }
    return map
  }, [lines])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(lines.map((l) => l.id)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function submit() {
    if (selected.size === 0) {
      setError('En az bir kalem seçin.')
      return
    }
    setError(null)

    const failed: string[] = []
    for (const [orderId, orderLines] of groups) {
      const lineIdsForOrder = orderLines.filter((l) => selected.has(l.id)).map((l) => l.id)
      if (lineIdsForOrder.length === 0) continue
      const allSelected = lineIdsForOrder.length === orderLines.length

      const res = await fetch(`/api/admin/orders/${orderId}/confirm-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Admin teslim onayı kuyruğundan onaylandı',
          ...(allSelected ? {} : { orderLineIds: lineIdsForOrder }),
        }),
      })

      if (!res.ok) {
        failed.push(orderId.slice(-8).toUpperCase())
      }
    }

    if (failed.length > 0) {
      setError(`${failed.length} sipariş onaylanamadı: ${failed.join(', ')}`)
    } else {
      setSelected(new Set())
    }
    startTransition(() => router.refresh())
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={selectAll}
          className="rounded-md border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
        >
          Tümünü Seç
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="rounded-md border px-3 py-1 text-xs font-medium"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
        >
          Temizle
        </button>
        <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {selected.size} kalem seçildi
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={pending || selected.size === 0}
          className="ml-auto rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {pending ? 'Onaylanıyor…' : 'Seçilenleri Teslim Onayla'}
        </button>
      </div>

      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-destructive, #dc2626)' }}>
          {error}
        </p>
      ) : null}

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Seç</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Sipariş</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Müşteri</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Satıcı</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Ürün</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Kargo</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Tarih</th>
              <th className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Gün Geçti</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const shipped = new Date(line.shippedAt)
              const daysAgo = Math.floor((Date.now() - shipped.getTime()) / (24 * 60 * 60 * 1000))
              return (
                <tr key={line.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(line.id)}
                      onChange={() => toggle(line.id)}
                      disabled={pending}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/siparisler/${line.orderId}`} className="hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {line.orderNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>{line.customerName}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>{line.sellerName}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-primary)' }}>
                    {line.productName} <span style={{ color: 'var(--color-muted-fg)' }}>× {line.quantity}</span>
                  </td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>{line.cargoProvider}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--color-muted-fg)' }}>
                    {shipped.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                  </td>
                  <td className="px-3 py-2 tabular-nums" style={{ color: daysAgo >= 5 ? '#dc2626' : 'var(--color-muted-fg)' }}>
                    {daysAgo} gün
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
