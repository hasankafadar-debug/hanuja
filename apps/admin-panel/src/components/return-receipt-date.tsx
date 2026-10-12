'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export function ReturnReceiptDate({ id }: { id: string }) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function save() {
    setPending(true)
    try {
      const response = await csrfFetch(`/api/admin/returns/${id}/receipt-date`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ receivedAt: new Date(date + ':00+03:00').toISOString() }) })
      if (!response.ok) { setError('Teslim tarihi kaydedilemedi.'); return }
      setError(''); router.refresh()
    } catch { setError('Teslim tarihi kaydedilemedi.') } finally { setPending(false) }
  }
  return <div className="space-y-2 rounded border p-4">
    <label className="block">Doğrulanmış iade teslim tarihi (Türkiye saati)
      <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className="ml-2 rounded border p-2" />
    </label>
    <Button onClick={() => void save()} disabled={!date || pending}>Teslim tarihini kaydet</Button>
    {error ? <p role="alert">{error}</p> : null}
  </div>
}
