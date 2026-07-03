'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

const REJECTION_REASONS = [
  'Stok hatası',
  'Fiyat hatası',
  'Üretim imkansızlığı',
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

  return (
    <div className={open ? 'w-full md:col-span-2' : 'w-full'}>
      {!open ? (
        <Button variant="destructive" className="w-full" onClick={() => setOpen(true)}>
          Siparişi İptal Et
        </Button>
      ) : (
        <div
          role="dialog"
          aria-labelledby="reject-dialog-title"
          className="w-full space-y-3 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-destructive)', backgroundColor: '#fff5f5' }}
        >
          <p
            id="reject-dialog-title"
            className="text-sm font-semibold"
            style={{ color: 'var(--color-destructive)' }}
          >
            Siparişi İptal Et
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Sipariş iptal edilirse ürün tutarının %20&apos;si oranında ceza uygulanır. Devam etmek istiyor musunuz?
          </p>
          <label htmlFor="rejection-reason" className="sr-only">
            Sebep
          </label>
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
            <option value="">- Sebep seçin -</option>
            {REJECTION_REASONS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          {error ? (
            <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" size="sm" disabled={!reason || loading} onClick={handleReject}>
              {loading ? 'İşleniyor...' : 'Siparişi İptal Et'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
            >
              Vazgeç
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
