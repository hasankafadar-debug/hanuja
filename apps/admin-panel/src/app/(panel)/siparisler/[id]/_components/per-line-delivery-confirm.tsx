'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type Line = {
  id: string
  productName: string
  quantity: number
  deliveryConfirmedAt: Date | string | null
}

export function PerLineDeliveryConfirm({
  orderId,
  lines,
  canConfirm,
}: {
  orderId: string
  lines: Line[]
  /** false when the order is in a status where admin cannot manually confirm */
  canConfirm: boolean
}) {
  const router = useRouter()
  const pendingLines = lines.filter((l) => !l.deliveryConfirmedAt)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!canConfirm || pendingLines.length === 0) {
    return null
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(pendingLines.map((l) => l.id)))
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
    const allSelected = selected.size === pendingLines.length

    const res = await fetch(`/api/admin/orders/${orderId}/confirm-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Admin onayı ile teslim onaylandı',
        ...(allSelected ? {} : { orderLineIds: [...selected] }),
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data?.error?.message ?? 'Onay başarısız.')
      return
    }

    setSelected(new Set())
    startTransition(() => router.refresh())
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Manuel Teslim Onayı (Per-Line)
        </h3>
        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={selectAll}
            className="rounded-md border px-2 py-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
          >
            Tümünü Seç
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border px-2 py-1"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
          >
            Temizle
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Sadece teslim olduğunu bildiğiniz kalemleri seçip onaylayın. Tüm kalemler onaylandığında sipariş{' '}
        <strong>delivery_confirmed</strong> durumuna geçer ve payout sayacı başlar.
      </p>

      <ul className="mb-3 space-y-1">
        {pendingLines.map((line) => (
          <li key={line.id} className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(line.id)}
                onChange={() => toggle(line.id)}
                disabled={pending}
              />
              <span style={{ color: 'var(--color-primary)' }}>
                {line.productName}
                <span className="ml-1" style={{ color: 'var(--color-muted-fg)' }}>
                  × {line.quantity}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="mb-2 text-sm" style={{ color: 'var(--color-destructive, #dc2626)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={pending || selected.size === 0}
          className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {pending ? 'Onaylanıyor…' : `Seçilen ${selected.size} kalemi onayla`}
        </button>
      </div>
    </section>
  )
}
