'use client'

import Link from 'next/link'
import { useState } from 'react'
import { requestPasswordReset } from '@/lib/auth-client'

const GENERIC_SUCCESS_MESSAGE =
  'Bu adresle eşleşen bir admin hesabı varsa şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu ve spam klasörünüzü kontrol edin.'

export default function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: requestError } = await requestPasswordReset({
        email,
        redirectTo: '/sifre-sifirla',
      })

      if (requestError) {
        setError('İstek gönderilemedi. Lütfen bir süre sonra tekrar deneyin.')
        return
      }

      // Do not expose whether the submitted address belongs to an admin account.
      setSent(true)
    } catch {
      setError('İstek gönderilemedi. Bağlantınızı kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
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
        <h1 className="mb-2 text-lg font-semibold text-neutral-900">İsteğiniz alındı</h1>
        <p className="text-sm text-neutral-500" role="status">
          {GENERIC_SUCCESS_MESSAGE}
        </p>
        <Link
          href="/giris"
          className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline"
        >
          Giriş sayfasına dön
        </Link>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-2 text-xl font-semibold text-neutral-900">Şifremi Unuttum</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Admin hesabınızda kullandığınız e-posta adresini girin.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-neutral-700">
            E-posta
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
          {loading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}
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
