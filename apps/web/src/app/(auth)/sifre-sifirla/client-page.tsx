'use client'

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { authClient } from '@/lib/auth-client'
import { getCustomerPasswordErrors } from '@hanuja/security/password-policy'

export function ResetPasswordPageClient() {
  const searchParams = useSearchParams()
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const passwordErrors = getCustomerPasswordErrors(password)
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
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      })

      if (resetError) {
        const message = resetError.message?.toLowerCase() ?? ''
        const isTokenRelated =
          message.includes('token') || message.includes('expired') || message.includes('invalid')
        setError(
          !isTokenRelated && resetError.message
            ? resetError.message
            : 'Şifre sıfırlanamadı. Bağlantının süresi dolmuş veya geçersiz olabilir.',
        )
        return
      }

      setSuccess(true)
    } catch {
      setError('Şifre sıfırlanamadı. Bağlantıyı kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-neutral-900 mb-2">Geçersiz Bağlantı</h1>
        <p className="text-sm text-neutral-500">
          Şifre sıfırlama bağlantısı eksik veya hatalı. Lütfen yeni bir bağlantı isteyin.
        </p>
        <a
          href="/sifremi-unuttum"
          className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline"
        >
          Yeni bağlantı iste
        </a>
      </div>
    )
  }

  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-neutral-900 mb-2">Şifreniz Güncellendi</h1>
        <p className="text-sm text-neutral-500">Yeni şifrenizle giriş yapabilirsiniz.</p>
        <a href="/giris" className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline">
          Giriş sayfasına git
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
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
          <p className="mt-1 text-xs text-neutral-400">En az 8 karakter, en az 1 harf ve 1 rakam içermeli.</p>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-sm font-medium text-neutral-700 mb-1">
            Yeni Şifre Tekrar
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
        >
          {loading ? 'Kaydediliyor...' : 'Şifreyi Kaydet'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        <a href="/giris" className="font-medium text-neutral-900 hover:underline">
          Giriş sayfasına dön
        </a>
      </p>
    </div>
  )
}
