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
  Input,
  Textarea,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'

interface AdminOrderActionsProps {
  orderId: string
  canConfirmDelivery: boolean
  hasEftPendingPayment: boolean
  hasBlockablePayout: boolean
  canCancel: boolean
  manualPenalty?: {
    sellerId: string
    sellerName: string
    defaultAmount: string
  } | null
}

export function AdminOrderActions({
  orderId,
  canConfirmDelivery,
  hasEftPendingPayment,
  hasBlockablePayout,
  canCancel,
  manualPenalty,
}: AdminOrderActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [isPenaltyOpen, setIsPenaltyOpen] = useState(false)
  const [penaltyReason, setPenaltyReason] = useState('Satıcı yükümlülüğünü yerine getirmediği için manuel ceza uygulandı.')
  const [penaltyAmount, setPenaltyAmount] = useState(manualPenalty?.defaultAmount ?? '')

  async function doAction(
    key: string,
    url: string,
    body: Record<string, string>,
    confirmMsg: string,
  ) {
    if (!confirm(confirmMsg)) return
    setLoading(key)
    try {
      const res = await csrfFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(getApiErrorMessage(data, 'İşlem başarısız. Detay için loglara bakın.'))
        return
      }
      router.refresh()
    } catch {
      alert('Ağ hatası. Tekrar deneyin.')
    } finally {
      setLoading(null)
    }
  }

  async function applyManualPenalty() {
    if (!manualPenalty) return

    setLoading('manual-penalty')
    try {
      const res = await csrfFetch(`/api/admin/orders/${orderId}/penalties`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: manualPenalty.sellerId,
          manualReason: penaltyReason,
          penaltyAmount: Number(penaltyAmount),
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(getApiErrorMessage(data, 'Ceza uygulanamadı.'))
        return
      }

      setIsPenaltyOpen(false)
      router.refresh()
    } catch {
      alert('Ağ hatası. Tekrar deneyin.')
    } finally {
      setLoading(null)
    }
  }

  const busy = loading !== null

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {/* Teslim onayı artık üstteki "Per-Line Teslim Onayı" kartından yapılıyor —
            tek tıkla tüm siparişi onaylayan buton kaldırıldı. */}

        {hasEftPendingPayment && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              doAction(
                'payment',
                `/api/admin/payments/eft/${orderId}/approve`,
                {},
                'Bu EFT ödemesini onaylamak istiyor musunuz? Sipariş satıcıya iletilecek.',
              )
            }
          >
            {loading === 'payment' ? '...' : 'Ödemeyi Onayla'}
          </Button>
        )}

        {hasBlockablePayout && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              doAction(
                'block',
                `/api/admin/orders/${orderId}/block-payout`,
                { reason: 'Admin incelemesi nedeniyle bloke' },
                'Bu siparişin hakedişini bloke etmek istiyor musunuz?',
              )
            }
          >
            {loading === 'block' ? '...' : 'Hakedişi Bloke Et'}
          </Button>
        )}

        {manualPenalty && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setPenaltyAmount(manualPenalty.defaultAmount)
              setIsPenaltyOpen(true)
            }}
          >
            {loading === 'manual-penalty' ? '...' : 'Manuel Ceza Uygula'}
          </Button>
        )}

        {canCancel && (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() =>
              doAction(
                'cancel',
                `/api/admin/orders/${orderId}/cancel`,
                { reason: 'Admin kararı ile iptal edildi' },
                'Bu siparişi iptal etmek istiyor musunuz? Bu işlem geri alınamaz.',
              )
            }
          >
            {loading === 'cancel' ? '...' : 'Siparişi İptal Et'}
          </Button>
        )}

        {!canConfirmDelivery && !hasEftPendingPayment && !hasBlockablePayout && !canCancel && !manualPenalty && (
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Bu sipariş için şu anda uygulanabilir admin işlemi yok.
          </p>
        )}
      </div>

      <Dialog open={isPenaltyOpen} onOpenChange={setIsPenaltyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuel Ceza Uygula</DialogTitle>
            <DialogDescription>
              Varsayılan tutar sipariş satır toplamının %20&apos;sidir. Gerekirse tutarı override edebilirsiniz.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--color-border)' }}>
              <strong>{manualPenalty?.sellerName}</strong>
            </div>

            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={penaltyAmount}
              onChange={(event) => setPenaltyAmount(event.target.value)}
              placeholder="Ceza tutarı"
            />

            <Textarea
              rows={5}
              value={penaltyReason}
              onChange={(event) => setPenaltyReason(event.target.value)}
              placeholder="Ceza gerekçesi"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPenaltyOpen(false)} disabled={busy}>
              Vazgeç
            </Button>
            <Button onClick={applyManualPenalty} disabled={busy}>
              {loading === 'manual-penalty' ? 'Uygulanıyor...' : 'Cezayı Uygula'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
