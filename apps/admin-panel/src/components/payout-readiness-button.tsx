'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'

export function PayoutReadinessButton({ payoutId, manual }: { payoutId: string; manual: boolean }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  async function refresh() {
    setLoading(true)
    setMessage('')
    try {
      const response = await csrfFetch(`/api/admin/payouts/${payoutId}/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearManualBlock: manual, reason: reason.trim() || undefined }),
      })
      const payload = await response.json()
      if (!response.ok) setMessage(getApiErrorMessage(payload, 'İşlem tamamlanamadı'))
      else {
        setMessage(payload.data.status === 'payout_ready' ? 'Hakediş ödemeye hazır.'
          : payload.data.blockedReason || 'Zorunlu bekleme süresi devam ediyor.')
        router.refresh()
      }
    } catch { setMessage('Bağlantı kurulamadı. Tekrar deneyin.') }
    finally { setLoading(false) }
  }
  return <div className="min-w-48 max-w-xs space-y-2 whitespace-normal">
    {manual && <Input aria-label="Manuel bloke kaldırma gerekçesi" placeholder="Bloke kaldırma gerekçesi"
      value={reason} onChange={(event) => setReason(event.target.value)} />}
    <Button size="sm" variant="outline" disabled={loading || (manual && reason.trim().length < 5)}
      onClick={() => void refresh()}>
      {loading ? 'Kontrol ediliyor...' : manual ? 'Manuel blokeyi kaldır' : 'Uygunluğu yeniden kontrol et'}
    </Button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>
}
