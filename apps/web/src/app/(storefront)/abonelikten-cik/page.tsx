'use client'
import { useState } from 'react'

export default function UnsubscribePage() {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function unsubscribe() {
    setBusy(true)
    setError('')
    try {
      const token = new URLSearchParams(window.location.search).get('token')
      if (!token) throw new Error('Geçersiz çıkış bağlantısı.')
      const res = await fetch(`/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`, { method: 'POST' })
      if (!res.ok) throw new Error('İşlem tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin.')
      setDone(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'İşlem tamamlanamadı.') }
    finally { setBusy(false) }
  }
  return <section className="mx-auto max-w-lg space-y-5 px-4 py-16">
    <h1 className="text-2xl font-semibold">{done ? 'E-posta reklam aboneliğiniz kapatıldı' : 'E-posta reklam aboneliğinden çıkış'}</h1>
    <p>Sipariş ve güvenlik gibi işlemsel e-postalar devam eder. Bu işlem SMS tercihinizi değiştirmez.</p>
    {!done && <button disabled={busy} onClick={() => void unsubscribe()} className="rounded bg-black px-5 py-3 text-white disabled:opacity-50">{busy ? 'İşleniyor…' : 'E-posta reklam aboneliğinden çık'}</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
