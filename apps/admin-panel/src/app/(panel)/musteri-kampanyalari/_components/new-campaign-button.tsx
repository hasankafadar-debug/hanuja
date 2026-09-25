'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export function NewCampaignButton({ channel }: { channel: 'email' | 'sms' }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create() {
    setBusy(true)
    setError('')
    try {
      const response = await csrfFetch('/api/admin/customer-campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Taslak oluşturulamadı.')
      router.push(`/musteri-kampanyalari/${payload.data.id}`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Taslak oluşturulamadı.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-1"><Button onClick={() => void create()} disabled={busy}>{busy ? 'Oluşturuluyor…' : 'Yeni taslak'}</Button>{error && <p role="alert" className="text-sm text-red-600">{error}</p>}</div>
}
