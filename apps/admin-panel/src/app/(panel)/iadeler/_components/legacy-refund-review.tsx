'use client'

import { useState, useRef, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@hanuja/ui'
import { csrfFetch } from '../../../../lib/csrf-fetch'
import { getApiErrorMessage } from '../../../../lib/api-error'

export function LegacyRefundReview({
  refundId,
  updatedAt,
}: {
  refundId: string
  updatedAt: string
}) {
  const router = useRouter()
  const busy = useRef(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy.current) return
    busy.current = true
    setPending(true)
    try {
      const response = await csrfFetch(`/api/admin/refunds/${refundId}/reassess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, expectedUpdatedAt: updatedAt }),
      })
      const payload = await response.json().catch(() => null)
      setMessage(
        response.ok
          ? 'Finansal kontrol tamamlandı. Ödeme durumunu siparişten kontrol edin.'
          : getApiErrorMessage(payload, 'İnceleme tamamlanamadı. Sayfayı yenileyin.'),
      )
      if (response.ok) router.refresh()
    } catch {
      setMessage('Sonuç doğrulanamadı. Sayfayı yenileyip kaydı kontrol edin.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 w-64 space-y-2 whitespace-normal">
      <p className="text-xs">
        Mevcut ödeme ve ürün kayıtlarını yeniden doğrular. Para göndermez; eksik kanıt varsa engeli
        korur.
      </p>
      <Input
        aria-label="Finansal inceleme gerekçesi"
        placeholder="İnceleme gerekçesi"
        required
        minLength={10}
        maxLength={1000}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={pending}
      />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? 'Kontrol ediliyor…' : 'Finansal kaydı yeniden değerlendir'}
      </Button>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </form>
  )
}
