'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface SellerStatusButtonsProps {
  sellerId: string
  currentStatus: string
}

export function SellerStatusButtons({ sellerId, currentStatus }: SellerStatusButtonsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function updateStatus(newStatus: 'active' | 'suspended' | 'rejected', confirmMsg: string) {
    if (!confirm(confirmMsg)) return
    setLoading(newStatus)
    try {
      const res = await fetch(`/api/admin/sellers/${sellerId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert((data as { error?: string }).error ?? 'İşlem başarısız.')
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
    <div className="flex gap-2">
      {currentStatus !== 'suspended' && (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            updateStatus(
              'suspended',
              'Bu satıcıyı askıya almak istiyor musunuz? Siparişleri ve ürünleri dondurulacak.',
            )
          }
        >
          {loading === 'suspended' ? '...' : 'Askıya Al'}
        </Button>
      )}

      {currentStatus !== 'active' && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            updateStatus(
              'active',
              'Bu satıcıyı aktif hale getirmek istiyor musunuz?',
            )
          }
        >
          {loading === 'active' ? '...' : 'Aktifleştir'}
        </Button>
      )}
    </div>
  )
}
