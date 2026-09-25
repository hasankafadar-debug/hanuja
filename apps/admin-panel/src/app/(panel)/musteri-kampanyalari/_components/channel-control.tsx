'use client'

import { useState } from 'react'
import { csrfFetch } from '@/lib/csrf-fetch'

export function ChannelControl({ channel, initial }: { channel: 'email' | 'sms'; initial: { enabled: boolean; version: number; canSend: boolean } }) {
  const [status, setStatus] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function disable() {
    setBusy(true)
    setError('')
    try {
      const response = await csrfFetch('/api/admin/customer-campaigns/channels', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, enabled: false, version: status.version }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.message ?? 'Kanal kapatılamadı.')
      setStatus(payload.data)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Kanal kapatılamadı.') }
    finally { setBusy(false) }
  }
  return <div><div className="flex items-center gap-3"><input type="checkbox" checked={status.enabled} disabled={busy || !status.enabled} onChange={() => void disable()} aria-label={`${channel === 'email' ? 'E-posta' : 'SMS'} gönderimi`} /><strong>{channel === 'email' ? 'E-posta' : 'SMS'} gönderimi {status.enabled ? 'açık' : 'kapalı'}</strong></div>{error && <p role="alert" className="mt-2 text-red-600">{error}</p>}</div>
}
