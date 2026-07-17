'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resetPassword } from '@/lib/auth-client'
import {
  getResetPasswordValidationError,
  INVALID_RESET_LINK_MESSAGE,
  MIN_ADMIN_PASSWORD_LENGTH,
} from './password-reset-validation'

export function AdminResetPasswordPageClient() {
  const searchParams = useSearchParams()
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams])
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    const validationError = getResetPasswordValidationError({
      token,
      password,
      confirmPassword,
    })

    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    try {
      const { error: resetError } = await resetPassword({
        newPassword: password,
        token,
      })

      if (resetError) {
        setError(INVALID_RESET_LINK_MESSAGE)
        return
      }

      setSuccess(true)
    } catch {
      setError('Şifre sıfırlanamadı. Bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <h1 className="mb-2 text-lg font-semibold text-neutral-900">Geçersiz Bağlantı</h1>
        <p className="text-sm text-neutral-500">
          Şifre sıfırlama bağlantısı eksik veya hatalı. Lütfen yeni bir bağlantı isteyin.
        </p>
        <Link
          href="/sifremi-unuttum"
          className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline"
        >
          Yeni bağlantı iste
        </Link>
      </div>
    )
  }

  if (success) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg
            aria-hidden="true"
            className="h-6 w-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-semibold text-neutral-900">Şifreniz Güncellendi</h1>
        <p className="text-sm text-neutral-500" role="status">
          Yeni şifrenizle admin paneline giriş yapabilirsiniz.
        </p>
        <Link
          href="/giris"
          className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline"
        >
          Giriş sayfasına git
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Şifre Sıfırla</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Admin hesabınız için yeni şifrenizi belirleyin.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
            Yeni Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={MIN_ADMIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
          <p className="mt-1 text-xs text-neutral-400">En az 8 karakter.</p>
        </div>

        <div>
          <label
            htmlFor="confirm-password"
            className="mb-1 block text-sm font-medium text-neutral-700"
          >
            Yeni Şifre Tekrar
          </label>
          <input
            id="confirm-password"
            type="password"
            required
            minLength={MIN_ADMIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Kaydediliyor...' : 'Şifreyi Kaydet'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        <Link href="/giris" className="font-medium text-neutral-900 hover:underline">
          Giriş sayfasına dön
        </Link>
      </p>
    </div>
  )
}
