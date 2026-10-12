'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Textarea } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export function AdminCommunicationReply({ endpoint, allowInternal = true }: { endpoint: string; allowInternal?: boolean }) {
  const router = useRouter()
  const [audience, setAudience] = useState('customer')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function send() {
    if (pending || body.trim().length < 2) return
    setPending(true)
    setError('')
    try {
      const response = await csrfFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audience, body }) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) { setError(payload?.message ?? 'Mesaj gönderilemedi.'); return }
      setBody('')
      router.refresh()
    } catch { setError('Mesaj gönderilemedi.') } finally { setPending(false) }
  }
  return <div className="space-y-3 rounded-xl border p-4">
    <label className="block text-sm">Mesajın alıcısı
      <select aria-label="Mesajın alıcısı" value={audience} onChange={(event) => setAudience(event.target.value)} className="ml-3 rounded border p-2" disabled={pending}>
        <option value="customer">Müşteri</option><option value="seller">Tasarımcı</option>
        {allowInternal ? <option value="internal">Yalnız yönetim</option> : null}
      </select>
    </label>
    <Textarea aria-label="Mesaj" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Seçilen alıcıya iletilecek mesaj" />
    <Button onClick={() => void send()} disabled={pending || body.trim().length < 2}>Mesajı gönder</Button>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
