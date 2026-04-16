'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface AdminOrderActionsProps {
  orderId: string
  canConfirmDelivery: boolean
  hasEftPendingPayment: boolean
  hasBlockablePayout: boolean
  canCancel: boolean
}

export function AdminOrderActions({
  orderId,
  canConfirmDelivery,
  hasEftPendingPayment,
  hasBlockablePayout,
  canCancel,
}: AdminOrderActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function doAction(
    key: string,
    url: string,
    body: Record<string, string>,
    confirmMsg: string,
  ) {
    if (!confirm(confirmMsg)) return
    setLoading(key)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(
          (data as { error?: string }).error ??
            'İşlem başarısız. Detay için loglara bakın.',
        )
        return
      }
      router.refresh()
    } catch {
      alert('Ağ hatası. Tekrar deneyin.')
    } finally {
      setLoading(null)
    }
  }

  const busy = loading !== null

  return (
    <div className="flex flex-wrap gap-2">
      {canConfirmDelivery && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            doAction(
              'confirm',
              `/api/admin/orders/${orderId}/confirm-delivery`,
              { reason: 'Admin onayı ile teslim onaylandı' },
              'Bu siparişin teslimini manuel olarak onaylamak istiyor musunuz? Payout sayacı başlayacak.',
            )
          }
        >
          {loading === 'confirm' ? '...' : 'Teslim Onayla'}
        </Button>
      )}

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

      {!canConfirmDelivery && !hasEftPendingPayment && !hasBlockablePayout && !canCancel && (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Bu sipariş için şu anda uygulanabilir admin işlemi yok.
        </p>
      )}
    </div>
  )
}
