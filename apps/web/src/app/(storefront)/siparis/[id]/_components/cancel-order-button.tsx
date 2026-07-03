'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@hanuja/ui'

const CANCEL_REASONS = [
  'Fikrim değişti',
  'Yanlış ürün seçtim',
  'Yanlış adres girdim',
  'Daha uygun fiyat buldum',
  'Teslimat süresi çok uzun',
  'Yanlışlıkla sipariş verdim',
  'Diğer',
]

interface Props {
  orderId: string
}

export function CancelOrderButton({ orderId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedReason, setSelectedReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    if (!selectedReason) {
      setError('Lütfen bir iptal nedeni seçin.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: selectedReason }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error ?? 'Sipariş iptal edilemedi.')
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Siparişi İptal Et
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Siparişi İptal Et</DialogTitle>
            <DialogDescription>
              Bu işlem geri alınamaz. İptal etmek istediğinizden emin misiniz?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              İptal nedeninizi seçin
            </p>
            <div className="space-y-2">
              {CANCEL_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors"
                  style={{
                    borderColor:
                      selectedReason === reason ? 'var(--color-accent)' : 'var(--color-border)',
                    backgroundColor:
                      selectedReason === reason ? 'var(--color-muted)' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    value={reason}
                    checked={selectedReason === reason}
                    onChange={() => {
                      setSelectedReason(reason)
                      setError(null)
                    }}
                    className="accent-[var(--color-accent)]"
                  />
                  <span style={{ color: 'var(--color-primary)' }}>{reason}</span>
                </label>
              ))}
            </div>

            {error ? (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Vazgeç
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancel}
              disabled={loading || !selectedReason}
            >
              {loading ? 'İptal ediliyor...' : 'Evet, iptal et'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
