'use client'
import { useEffect, useState } from 'react'
import { csrfFetch } from '@/lib/csrf-fetch'
type Status = { emailLegacyUnverified: boolean; smsLegacyUnverified: boolean }
export function CommunicationPreferencesForm() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/user/marketing-consent').then(async res => {
      if (!res.ok) throw new Error()
      const data = await res.json() as Status
      if (active) setStatus(data)
    }).catch(() => { if (active) setMessage('Tercihleriniz yüklenemedi. Lütfen sayfayı yenileyin.') })
    return () => { active = false }
  }, [])
  async function revoke(channel: 'email' | 'sms') {
    setBusy(true)
    try {
      const res = await csrfFetch('/api/user/marketing-consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, consented: false, source: 'account_settings' }) })
      if (!res.ok) throw new Error()
      setStatus(await res.json() as Status)
      setMessage('Seçtiğiniz kanalın reklam izni geri çekildi. İşlemsel bildirimler devam eder.')
    } catch { setMessage('Tercihiniz kaydedilemedi. Lütfen tekrar deneyin.') }
    finally { setBusy(false) }
  }
  return <section className="mx-auto max-w-lg space-y-5 rounded-xl border bg-white p-6">
    <h1 className="text-2xl font-semibold">İletişim Tercihleri</h1>
    <p className="text-sm text-neutral-600">İYS hazırlığı tamamlanana kadar reklam gönderimleri ve yeni izin verme kapalıdır. Mevcut izinlerinizi ayrı ayrı geri çekebilirsiniz.</p>
    {status ? (['email', 'sms'] as const).map(channel => {
      const legacy = channel === 'email' ? status.emailLegacyUnverified : status.smsLegacyUnverified
      return <div key={channel} className="space-y-2 border-t pt-4">
        <h2 className="font-medium">{channel === 'email' ? 'E-posta' : 'SMS'}</h2>
        <p className="text-sm text-neutral-600">{legacy ? 'Eski kayıt / doğrulanmamış — reklam gönderilemez.' : 'Reklam izni kapalı.'}</p>
        <button disabled className="mr-3 text-sm text-neutral-400">İzin ver (İYS hazırlığı bekleniyor)</button>
        <button type="button" disabled={busy} onClick={() => void revoke(channel)} className="rounded border px-3 py-2 text-sm disabled:opacity-50">İzni geri çek</button>
      </div>
    }) : <p role="status">Tercihler yükleniyor…</p>}
    <a href="/ticari-iletisim" className="block text-sm underline">Ticari iletişim bilgilendirmesi</a>
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>
}
