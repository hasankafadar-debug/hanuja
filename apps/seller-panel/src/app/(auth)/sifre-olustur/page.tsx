'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SifreOlusturPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Şifreler eşleşmiyor.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/seller/first-password', {
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
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
      <h1 className="text-xl font-semibold text-neutral-900 mb-2">Yeni Şifre Oluştur</h1>
      <p className="text-sm text-neutral-500 mb-6">
        İlk giriş için kalıcı şifrenizi belirleyin.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-1">
            Yeni Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-neutral-700 mb-1">
            Yeni Şifre Tekrar
          </label>
          <input
            id="confirm"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
        >
          {loading ? 'Kaydediliyor...' : 'Şifreyi Kaydet'}
        </button>
      </form>
    </div>
  )
}
