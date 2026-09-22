'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { csrfFetch } from '@/lib/csrf-fetch'

export function RetryButton({
  id,
  kind,
}: {
  id: string
  kind: 'delivery' | 'outbox'
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  if (!open)
    return (
      <button
        className="rounded border px-3 py-2 text-sm"
        onClick={() => setOpen(true)}
      >
        Yeniden dene
      </button>
    )
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          const response = await csrfFetch(
            `/api/admin/email-deliveries/${encodeURIComponent(id)}/retry`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ reason, kind }),
            },
          )
          if (!response.ok)
            throw new Error(
              'Yeniden deneme başlatılamadı. Kaydı yenileyip durumunu kontrol edin.',
            )
          setOpen(false)
          router.refresh()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'İşlem başarısız.')
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="block text-sm">
        Yeniden deneme gerekçesi
        <input
          className="mt-1 w-full rounded border p-2 text-black"
          required
          minLength={10}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-xs">
        Bu işlem yalnız bu kaydı yeniden işler. Başarılı gönderimler
        tekrarlanmaz.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <button className="rounded border px-3 py-2" disabled={busy}>
        {busy ? 'İşleniyor…' : 'Onayla ve kuyruğa al'}
      </button>{' '}
      <button type="button" disabled={busy} onClick={() => setOpen(false)}>
        Vazgeç
      </button>
    </form>
  )
}
