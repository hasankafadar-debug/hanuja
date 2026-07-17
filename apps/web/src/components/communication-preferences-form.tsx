'use client'

import { useEffect, useState } from 'react'
import { csrfFetch } from '@/lib/csrf-fetch'

type ConsentStatus = { emailConsented: boolean; smsConsented?: boolean }

export function CommunicationPreferencesForm() {
  const [consented, setConsented] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/user/marketing-consent')
      .then((res) => (res.ok ? (res.json() as Promise<ConsentStatus>) : Promise.reject(new Error('load'))))
      .then((data) => {
        if (active) setConsented(Boolean(data.emailConsented))
      })
      .catch(() => {
        if (active) {
          setIsError(true)
          setMessage('Tercihleriniz yüklenemedi. Lütfen sayfayı yenileyin.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  async function save() {
    setBusy(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await csrfFetch('/api/user/marketing-consent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consented }),
      })
      if (!res.ok) throw new Error('save')
      const data = (await res.json()) as ConsentStatus
      setConsented(Boolean(data.emailConsented))
      setMessage('Tercihiniz kaydedildi.')
    } catch {
      setIsError(true)
      setMessage('Tercihiniz kaydedilemedi. Lütfen tekrar deneyin.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-xl border bg-white p-6">
      <div>
        <h1 className="text-2xl font-semibold">İletişim Tercihleri</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Kampanya ve indirim duyurularını e-posta ve SMS ile alıp almayacağınızı buradan yönetebilirsiniz.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500" role="status">
          Tercihleriniz yükleniyor…
        </p>
      ) : (
        <div className="flex items-start gap-3">
          <input
            id="marketingConsent"
            type="checkbox"
            checked={consented}
            disabled={busy}
            onChange={(event) => setConsented(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-900/10 disabled:opacity-50"
          />
          <label htmlFor="marketingConsent" className="text-sm leading-relaxed text-neutral-700">
            Kampanya ve indirim e-postaları + SMS almak istiyorum.
          </label>
        </div>
      )}

      <button
        type="button"
        onClick={() => void save()}
        disabled={busy || loading}
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Kaydediliyor…' : 'Kaydet'}
      </button>

      {message ? (
        <p role="status" className={`text-sm ${isError ? 'text-red-600' : 'text-emerald-700'}`}>
          {message}
        </p>
      ) : null}
    </section>
  )
}
