'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Textarea,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'

export interface CancellableOrderItem {
  id: string
  label: string
  quantity: number
}

export function AdminOrderCancellationDialog({
  orderId,
  items,
  paymentCollected,
}: {
  orderId: string
  items: CancellableOrderItem[]
  paymentCollected: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const requestKey = useRef('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current || reason.trim().length < 5 || !Object.keys(selected).length) return
    busy.current = true
    setPending(true)
    setError(null)
    try {
      const response = await csrfFetch(`/api/admin/orders/${orderId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: reason.trim(),
          idempotencyKey: requestKey.current,
          items: Object.entries(selected).map(([orderLineId, quantity]) => ({
            orderLineId,
            quantity,
          })),
        }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        setError(getApiErrorMessage(body, 'İptal kaydedilemedi.'))
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError(
        'Sonuç doğrulanamadı. Sipariş durumunu kontrol edin; aynı seçimle tekrar deneyebilirsiniz.',
      )
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => {
          requestKey.current = crypto.randomUUID()
          setSelected(Object.fromEntries(items.map((item) => [item.id, item.quantity])))
          setReason('')
          setError(null)
          setOpen(true)
        }}
      >
        Ürün / Adet İptal Et
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy.current) setOpen(value)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>İptal edilecek ürün ve adetler</DialogTitle>
            <DialogDescription>
              {paymentCollected
                ? 'Seçilen adetlerin stoğu geri döner ve müşteri için ödeme iadesi kaydı açılır. Sevk edilen adetler iptal edilemez.'
                : 'Ödemesi alınmamış EFT siparişi tamamen iptal edilir; ödeme iadesi oluşmaz.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            {items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3">
                <label className="flex flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected[item.id] !== undefined}
                    disabled={pending || !paymentCollected}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = { ...current }
                        if (event.target.checked) next[item.id] = item.quantity
                        else delete next[item.id]
                        return next
                      })
                    }
                  />
                  {item.label}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  İptal adedi
                  <input
                    aria-label={`${item.label} iptal adedi`}
                    type="number"
                    min={1}
                    max={item.quantity}
                    className="w-20 rounded border p-2"
                    required
                    value={selected[item.id] ?? 1}
                    disabled={pending || !paymentCollected || selected[item.id] === undefined}
                    onChange={(event) =>
                      setSelected((current) => ({
                        ...current,
                        [item.id]: Number(event.target.value),
                      }))
                    }
                  />
                  / {item.quantity}
                </label>
              </div>
            ))}
            <label className="block space-y-1 text-sm">
              İptal gerekçesi
              <Textarea
                required
                minLength={5}
                maxLength={1000}
                value={reason}
                disabled={pending}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Vazgeç
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={pending || !Object.keys(selected).length || reason.trim().length < 5}
              >
                {pending ? 'Kaydediliyor…' : 'Seçilenleri İptal Et'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
