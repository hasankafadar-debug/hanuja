'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

export default function ExtensionRequestButton({
  orderId,
  pendingRequestId,
  variant = 'outline',
  triggerClassName,
}: {
  orderId: string
  pendingRequestId: string | null
  variant?: 'outline' | 'default'
  triggerClassName?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState(5)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (pendingRequestId) {
    return (
      <div
        className="w-full rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Bu siparis icin acik bir ek sure talebi var. Admin/musteri yaniti bekleniyor.
        </p>
      </div>
    )
  }

  async function submit() {
    setError(null)
    if (!reason.trim()) {
      setError('Talep sebebi gerekli.')
      return
    }
    if (days < 1 || days > 30) {
      setError('Is gunu sayisi 1-30 araliginda olmali.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/seller/orders/${orderId}/extension-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedDays: days, sellerReason: reason.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error?.message ?? 'Talep olusturulamadi.')
        setLoading(false)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('Baglanti hatasi.')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <div className="w-full">
        <Button variant={variant} className={triggerClassName} onClick={() => setOpen(true)}>
          Ek Sure Talep Et
        </Button>
      </div>
    )
  }

  return (
    <div
      className="w-full space-y-3 rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
        Ek Sure Talebi
      </p>
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Admin degerlendirecek. Gerekirse musteriden de onay istenebilir. Onaylanan sure boyunca gunluk gecikme cezasi
        durdurulur.
      </p>

      <label className="block">
        <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
          Talep edilen is gunu
        </span>
        <input
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="w-32 rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
          Sebep
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          placeholder="Orn. tedarikci gecikmesi nedeniyle..."
        />
      </label>

      {error ? (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={loading} onClick={submit}>
          {loading ? 'Gonderiliyor...' : 'Talep Et'}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Vazgec
        </Button>
      </div>
    </div>
  )
}
