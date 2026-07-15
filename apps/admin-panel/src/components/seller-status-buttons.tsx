'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface SellerStatusButtonsProps {
  sellerId: string
  currentStatus: string
  displayName: string
}

export function SellerStatusButtons({ sellerId, currentStatus, displayName }: SellerStatusButtonsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function updateStatus(newStatus: 'active' | 'suspended' | 'rejected', confirmMsg: string) {
    if (!confirm(confirmMsg)) return
    const reason = newStatus === 'suspended'
      ? window.prompt('Askıya alma gerekçesini yazın:')?.trim()
      : undefined
    if (newStatus === 'suspended' && !reason) {
      alert('Askıya alma gerekçesi zorunludur.')
      return
    }
    setLoading(newStatus)
    setMessage(null)
    try {
      const res = await csrfFetch(`/api/admin/sellers/${sellerId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, ...(reason ? { reason } : {}) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const error = data as { message?: string; error?: string }
        alert(error.message ?? error.error ?? 'İşlem başarısız.')
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

  async function deleteSeller() {
    const confirmation = window.prompt(
      `Kalıcı silmeyi onaylamak için satıcı adını yazın: ${displayName}`,
    )
    if (confirmation !== displayName) {
      if (confirmation !== null) alert('Satıcı adı eşleşmedi; silme işlemi iptal edildi.')
      return
    }

    setLoading('delete')
    setMessage(null)
    try {
      const response = await csrfFetch(`/api/admin/sellers/${sellerId}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        setMessage(payload.message ?? 'Satıcı silinemedi.')
        return
      }
      router.push('/saticilar')
      router.refresh()
    } catch {
      setMessage('Ağ hatası. Tekrar deneyin.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
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
      <Button
        variant="destructive"
        size="sm"
        disabled={busy}
        onClick={deleteSeller}
      >
        {loading === 'delete' ? '...' : 'Kalıcı Sil'}
      </Button>
      {message ? <p className="w-full text-sm" role="status">{message}</p> : null}
    </div>
  )
}
