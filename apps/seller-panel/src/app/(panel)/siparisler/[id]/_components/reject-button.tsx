'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

const REJECTION_REASONS = [
  'Stok hatası',
  'Fiyat hatası',
  'Üretim imkânsızlığı',
  'Kalite sorunu',
  'Teknik sorun',
  'Mücbir sebep',
]

export default function RejectButton({ orderId }: { orderId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReject() {
    if (!reason) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/seller/orders/${orderId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata oluştu.')
        setLoading(false)
      } else {
        router.push('/siparisler')
        router.refresh()
      }
    } catch {
      setError('Bağlantı hatası.')
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="text-xs"
        style={{ color: 'var(--color-muted-fg)' }}
        onClick={() => setOpen(true)}
      >
        Siparişi Reddet (ceza uygulanabilir)
      </Button>
    )
  }

  return (
    <div
      role="dialog"
      aria-labelledby="reject-dialog-title"
      className="w-full rounded-xl border p-5 space-y-3"
      style={{ borderColor: 'var(--color-destructive)', backgroundColor: '#fff5f5' }}
    >
      <p id="reject-dialog-title" className="text-sm font-semibold" style={{ color: 'var(--color-destructive)' }}>
        ⚠ Siparişi Reddet
      </p>
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Ödenmiş siparişi reddetmek %20 ceza uygulanmasına neden olabilir. Bir red sebebi seçin:
      </p>
      <label htmlFor="rejection-reason" className="sr-only">Sebep</label>
      <select
        id="rejection-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-primary)',
        }}
      >
        <option value="">— Sebep seçin —</option>
        {REJECTION_REASONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          disabled={!reason || loading}
          onClick={handleReject}
        >
          {loading ? 'İşleniyor…' : 'Reddet'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setOpen(false); setError(null) }}
        >
          Vazgeç
        </Button>
      </div>
    </div>
  )
}
