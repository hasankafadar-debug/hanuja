'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface Row {
  id: string
  sellerName: string
  ibanMasked: string
  previousIbanMasked: string | null
  bankName: string
  status: string
  activatesAt: string | null
  flags: unknown
}

export function BankDetailReviewTable({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)

  async function submitAction(id: string, action: 'approve' | 'block') {
    const reason = reasons[id]?.trim()
    if (!reason) {
      setMessage('Onay ve blok işlemleri için gerekçe girin.')
      return
    }

    const res = await csrfFetch(`/api/admin/bank-details/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      setMessage(payload.error ?? 'İşlem başarısız oldu.')
      return
    }
    setMessage('İşlem kaydedildi.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {message && <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>{message}</p>}
      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{row.sellerName}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--color-muted-fg)' }}>
                  {row.previousIbanMasked ? `${row.previousIbanMasked} → ` : ''}
                  {row.ibanMasked}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {row.bankName} · {row.status}
                  {row.activatesAt ? ` · ${new Date(row.activatesAt).toLocaleString('tr-TR')}` : ''}
                </p>
                {row.flags != null ? (
                  <pre className="mt-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {String(JSON.stringify(row.flags, null, 2) ?? '')}
                  </pre>
                ) : null}
              </div>
              <div className="flex min-w-80 flex-col gap-2">
                <Input
                  value={reasons[row.id] ?? ''}
                  onChange={(event) => setReasons((current) => ({ ...current, [row.id]: event.target.value }))}
                  placeholder="Gerekçe"
                />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => void submitAction(row.id, 'approve')}>
                    Onayla
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void submitAction(row.id, 'block')}>
                    Bloke Et
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
