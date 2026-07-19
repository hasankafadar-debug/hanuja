'use client'
import { useState, type FormEvent } from 'react'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getCustomerPasswordErrors } from '@hanuja/security/password-policy'

export function ChangePasswordForm({ endpoint = '/api/user/change-password' }: { endpoint?: string }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const form = new FormData(event.currentTarget)
    const newPassword = String(form.get('newPassword') ?? '')
    const passwordErrors = getCustomerPasswordErrors(newPassword)
    if (passwordErrors.length > 0) { setMessage(passwordErrors[0] ?? ''); setBusy(false); return }
    if (form.get('newPassword') !== form.get('confirmPassword')) { setMessage('Yeni parolalar eşleşmiyor.'); setBusy(false); return }
    const response = await csrfFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword: form.get('newPassword') }) })
    const data = await response.json().catch(() => ({}))
    setMessage(response.ok ? 'Parolanız değiştirildi; diğer oturumlar kapatıldı.' : data.message ?? data.error ?? 'Parola değiştirilemedi.')
    if (response.ok) event.currentTarget.reset()
    setBusy(false)
  }
  return <form onSubmit={submit} className="mx-auto max-w-lg space-y-4 rounded-xl border bg-white p-6">
    <h1 className="text-2xl font-semibold">Parola değiştir</h1>
    <label className="block">Mevcut parola<input name="currentPassword" type="password" required autoComplete="current-password" className="mt-1 w-full rounded border p-2" /></label>
    <label className="block">Yeni parola<input name="newPassword" type="password" minLength={8} required autoComplete="new-password" className="mt-1 w-full rounded border p-2" />
      <span className="mt-1 block text-xs text-neutral-400">En az 8 karakter, en az 1 harf ve 1 rakam içermeli.</span>
    </label>
    <label className="block">Yeni parola tekrar<input name="confirmPassword" type="password" minLength={8} required autoComplete="new-password" className="mt-1 w-full rounded border p-2" /></label>
    <button disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">{busy ? 'Değiştiriliyor…' : 'Parolayı değiştir'}</button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </form>
}
