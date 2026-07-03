'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ExtensionRequestDecision({
  orderId,
  requestId,
  requestedDays,
  questionFromAdmin,
  sellerReason,
}: {
  orderId: string
  requestId: string
  requestedDays: number
  questionFromAdmin: string | null
  sellerReason: string
}) {
  const router = useRouter()
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!decision) return
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/extension-request/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          decision,
          ...(note.trim() ? { responseNote: note.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data?.error?.message ?? 'Yanıt kaydedilemedi.')
        setPending(false)
        return
      }
      router.refresh()
    } catch {
      setError('Bağlantı hatası.')
      setPending(false)
    }
  }

  return (
    <section
      className="rounded-2xl border p-6"
      style={{ borderColor: '#facc15', backgroundColor: '#fefce8' }}
    >
      <h2 className="mb-2 text-lg font-semibold" style={{ color: '#854d0e' }}>
        Satıcı ek süre talep ediyor
      </h2>
      <p className="mb-4 text-sm" style={{ color: '#713f12' }}>
        Satıcı {requestedDays} iş günü ek süre istiyor. Onayınızı bekliyoruz.
      </p>

      <div className="mb-3 rounded-md bg-white p-3 text-sm" style={{ borderColor: '#fde047' }}>
        <p className="mb-1 text-xs font-medium" style={{ color: '#92400e' }}>
          Satıcı gerekçesi:
        </p>
        <p style={{ color: '#1f2937' }}>{sellerReason}</p>
      </div>

      {questionFromAdmin ? (
        <div className="mb-4 rounded-md bg-white p-3 text-sm">
          <p className="mb-1 text-xs font-medium" style={{ color: '#1e3a8a' }}>
            Hanuja'dan size:
          </p>
          <p style={{ color: '#1f2937' }}>{questionFromAdmin}</p>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setDecision('approve')}
          className="rounded-md px-4 py-2 text-sm font-medium"
          style={{
            backgroundColor: decision === 'approve' ? '#16a34a' : '#fff',
            color: decision === 'approve' ? '#fff' : '#16a34a',
            border: '1px solid #16a34a',
          }}
        >
          Onaylıyorum
        </button>
        <button
          type="button"
          onClick={() => setDecision('reject')}
          className="rounded-md px-4 py-2 text-sm font-medium"
          style={{
            backgroundColor: decision === 'reject' ? '#dc2626' : '#fff',
            color: decision === 'reject' ? '#fff' : '#dc2626',
            border: '1px solid #dc2626',
          }}
        >
          Reddediyorum
        </button>
      </div>

      {decision ? (
        <>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium" style={{ color: '#713f12' }}>
              Yanıt notu (isteğe bağlı)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: '#d1d5db' }}
            />
          </label>

          {error ? (
            <p className="mb-3 text-sm" style={{ color: '#b91c1c' }}>
              {error}
            </p>
          ) : null}

          <p className="mb-3 text-xs" style={{ color: '#92400e' }}>
            Yanıtınız zaman damgası, IP ve oturum bilgisiyle birlikte kayıt altına alınır.
          </p>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={pending}
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: '#1f2937' }}
            >
              {pending ? 'Gönderiliyor…' : 'Yanıtımı Onayla'}
            </button>
            <button
              type="button"
              onClick={() => {
                setDecision(null)
                setNote('')
                setError(null)
              }}
              disabled={pending}
              className="rounded-md border px-4 py-2 text-sm"
              style={{ borderColor: '#d1d5db' }}
            >
              Vazgeç
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}
