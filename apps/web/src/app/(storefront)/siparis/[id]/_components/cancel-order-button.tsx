'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Minus, Plus } from 'lucide-react'
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
  /** EFT payment not yet confirmed: the server accepts only a whole-order cancellation. */
  wholeOrderOnly?: boolean
}

export function CancelOrderButton({ orderId, lines, wholeOrderOnly = false }: Props) {
  const wholeOrder = wholeOrderOnly && Boolean(lines)
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
        ?.map((line) => ({
          orderLineId: line.id,
          quantity: wholeOrder ? line.availableQuantity : (quantities[line.id] ?? 0),
        }))
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
        {lines && !wholeOrder ? 'Ürün / Adet İptal Et' : 'Siparişi İptal Et'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {lines && !wholeOrder ? 'İptal edilecek ürün ve adetler' : 'Siparişi İptal Et'}
            </DialogTitle>
            <DialogDescription>
              {wholeOrder
                ? 'Havale/EFT ödemeniz henüz onaylanmadığı için yalnız siparişin tamamı iptal edilebilir.'
                : lines
                  ? 'Satıcı kargoya vermeden önce seçtiğiniz adetler hemen iptal edilir.'
                  : 'Bu işlem geri alınamaz. İptal etmek istediğinizden emin misiniz?'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {lines && wholeOrder ? (
              <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                {lines.map((line) => (
                  <div key={line.id} className="flex items-center gap-3 px-3 py-3">
                    <span
                      className="min-w-0 flex-1 text-sm font-medium"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {line.name}
                    </span>
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {line.availableQuantity} adet
                    </span>
                  </div>
                ))}
              </div>
            ) : lines ? (
              <div className="divide-y rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                {lines.map((line) => {
                  const quantity = quantities[line.id] ?? 0
                  const selected = quantity > 0
                  const stepQuantity = (delta: number) =>
                    setQuantities((current) => ({
                      ...current,
                      [line.id]: Math.max(
                        1,
                        Math.min(line.availableQuantity, (current[line.id] ?? 1) + delta),
                      ),
                    }))
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
                      <span
                        className="min-w-0 flex-1 text-sm font-medium"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {line.name}
                      </span>
                      {/* Sepet sayfasındaki −/+ adet deseniyle aynı; satır seçili değilken soluk ve etkileşimsiz */}
                      <div
                        className={`flex items-center gap-2 ${selected ? '' : 'pointer-events-none opacity-40'}`}
                        aria-hidden={!selected}
                      >
                        <button
                          type="button"
                          onClick={() => stepQuantity(-1)}
                          disabled={!selected || quantity <= 1}
                          className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors hover:bg-[var(--color-muted)] disabled:opacity-40 disabled:hover:bg-transparent"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                          aria-label="Adet azalt"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span
                          className="w-6 text-center text-sm font-semibold tabular-nums"
                          style={{ color: 'var(--color-primary)' }}
                          aria-live="polite"
                        >
                          {selected ? quantity : 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => stepQuantity(1)}
                          disabled={!selected || quantity >= line.availableQuantity}
                          className="flex h-7 w-7 items-center justify-center rounded-full border transition-colors hover:bg-[var(--color-muted)] disabled:opacity-40 disabled:hover:bg-transparent"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                          aria-label="Adet artır"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
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
              {loading
                ? 'İptal ediliyor...'
                : lines && !wholeOrder
                  ? 'Seçilenleri İptal Et'
                  : 'Evet, iptal et'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
