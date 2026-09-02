'use client'

import { useRef, useState, useTransition } from 'react'
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
import { csrfFetch } from '@/lib/csrf-fetch'

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
  lines?: Array<{
    id: string
    name: string
    availableQuantity: number
  }>
}

export function CancelOrderButton({ orderId, lines }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selectedReason, setSelectedReason] = useState('')
  const [loading, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const idempotencyKey = useRef<string>(crypto.randomUUID())

  async function handleCancel() {
    if (!selectedReason) {
      setError('Lütfen bir iptal nedeni seçin.')
      return
    }
    setError(null)
    startTransition(async () => {
      const items = lines
        ?.map((line) => ({ orderLineId: line.id, quantity: quantities[line.id] ?? 0 }))
        .filter((item) => item.quantity > 0)
      if (lines && (!items || items.length === 0)) {
        setError('İptal etmek istediğiniz en az bir ürün seçin.')
        return
      }
      const res = await csrfFetch(
        lines ? `/api/orders/${orderId}/cancellations` : `/api/orders/${orderId}/cancel`,
        {
        method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(lines ? { 'Idempotency-Key': idempotencyKey.current } : {}),
          },
          body: JSON.stringify({ reason: selectedReason, ...(lines ? { items } : {}) }),
        },
      )
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.message ?? payload.error ?? 'Sipariş iptal edilemedi.')
        return
      }
      idempotencyKey.current = crypto.randomUUID()
      setQuantities({})
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        {lines ? 'Ürün / Adet İptal Et' : 'Siparişi İptal Et'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{lines ? 'İptal edilecek ürün ve adetler' : 'Siparişi İptal Et'}</DialogTitle>
            <DialogDescription>
              {lines
                ? 'Satıcı kargoya vermeden önce seçtiğiniz adetler hemen iptal edilir.'
                : 'Bu işlem geri alınamaz. İptal etmek istediğinizden emin misiniz?'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {lines ? (
              <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                {lines.map((line) => {
                  const selected = (quantities[line.id] ?? 0) > 0
                  return (
                    <div key={line.id} className="flex items-center gap-3 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [line.id]: event.target.checked ? 1 : 0,
                          }))
                        }
                        className="h-4 w-4 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0 flex-1 text-sm font-medium">{line.name}</span>
                      <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        Adet
                        <input
                          type="number"
                          min={1}
                          max={line.availableQuantity}
                          disabled={!selected}
                          value={selected ? quantities[line.id] : 1}
                          onChange={(event) => {
                            const quantity = Math.max(
                              1,
                              Math.min(line.availableQuantity, Number(event.target.value) || 1),
                            )
                            setQuantities((current) => ({ ...current, [line.id]: quantity }))
                          }}
                          className="h-9 w-16 rounded-md border bg-transparent px-2 text-center text-sm disabled:opacity-40"
                          style={{ borderColor: 'var(--color-border)' }}
                        />
                        / {line.availableQuantity}
                      </label>
                    </div>
                  )
                })}
              </div>
            ) : null}
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
              {loading ? 'İptal ediliyor...' : lines ? 'Seçilenleri İptal Et' : 'Evet, iptal et'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
