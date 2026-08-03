'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSellerPasswordErrors } from '@hanuja/security/password-policy'
import { csrfFetch } from '@/lib/csrf-fetch'

export default function SifreOlusturPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const passwordErrors = getSellerPasswordErrors(password)
    if (passwordErrors.length > 0) {
      setError(passwordErrors[0] ?? null)
      return
    }

    if (password !== confirmPassword) {
      setError('Şifreler eşleşmiyor.')
      return
    }

    setLoading(true)
    try {
      const res = await csrfFetch('/api/seller/first-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? 'Şifre güncellenemedi.')
        return
      }

      router.push('/dashboard')
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Yeni Şifre Oluştur</h1>
      <p className="mb-6 text-sm text-neutral-500">İlk giriş için kalıcı şifrenizi belirleyin.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
            Yeni Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
          <p className="mt-1 text-xs text-neutral-400">
            En az 8 karakter; en az 1 büyük harf, 1 küçük harf, 1 rakam ve 1 sembol içermeli.
          </p>
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm font-medium text-neutral-700">
            Yeni Şifre Tekrar
          </label>
          <input
            id="confirm"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Kaydediliyor...' : 'Şifreyi Kaydet'}
        </button>
      </form>
    </div>
  )
}
