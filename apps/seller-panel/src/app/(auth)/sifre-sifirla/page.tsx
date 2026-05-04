'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

export default function SifreSifirlaPage() {
  const params = useSearchParams()
  const token = useMemo(() => params.get('token') ?? '', [params])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Şifre sıfırlama bağlantısı eksik.')
      return
    }

    if (password !== confirmPassword) {
      setError('Şifreler eşleşmiyor.')
      return
    }

    setLoading(true)
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      })

      if (resetError) {
        setError('Şifre sıfırlanamadı. Lütfen bağlantıyı tekrar deneyin.')
        return
      }

      setSuccess(true)
    } catch {
      setError('Şifre sıfırlanamadı. Lütfen tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900 mb-2">Şifre güncellendi</h1>
        <p className="text-sm text-neutral-500">Yeni şifrenizle giriş yapabilirsiniz.</p>
        <a href="/giris" className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline">
          Giriş sayfasına dön
        </a>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
      <h1 className="text-xl font-semibold text-neutral-900 mb-2">Şifre Sıfırla</h1>
      <p className="text-sm text-neutral-500 mb-6">Yeni şifrenizi belirleyin.</p>

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
