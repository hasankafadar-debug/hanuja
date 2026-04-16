'use client'

import { useState } from 'react'
import { Button } from '@hanuja/ui'
import { Truck } from 'lucide-react'

export default function ShipmentForm({ orderId }: { orderId: string }) {
  const [trackingNumber, setTrackingNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!trackingNumber.trim()) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/seller/shipments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, trackingNumber: trackingNumber.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata oluştu.')
      } else {
        setSuccess(true)
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
          ✓ Kargo bilgisi kaydedildi.
        </p>
      </section>
    )
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h2 className="mb-4 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
        <Truck className="h-4 w-4" /> Kargo Bilgisi Gir
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="Kargo takip numarası"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          disabled={loading}
          className="flex h-10 flex-1 rounded-lg border px-3 text-sm outline-none focus:ring-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <Button type="submit" disabled={loading || !trackingNumber.trim()} className="gap-1.5">
          <Truck className="h-4 w-4" />
          {loading ? 'Kaydediliyor…' : 'Kargoya Ver'}
        </Button>
      </form>
      {error && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}
    </section>
  )
}
