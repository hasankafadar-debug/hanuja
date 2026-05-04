'use client'

import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

export default function SifremiUnuttumPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error: authError } = await authClient.requestPasswordReset({
        email,
        redirectTo: '/sifre-sifirla',
      })

      if (authError) {
        setError('İstek gönderilemedi. Lütfen tekrar deneyin.')
        return
      }

      setSent(true)
    } catch {
      setError('İstek gönderilemedi. Bağlantıyı kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8 text-center">
        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-neutral-900 mb-2">E-posta Gönderildi</h1>
        <p className="text-sm text-neutral-500">
          <span className="font-medium text-neutral-700">{email}</span> adresine şifre sıfırlama bağlantısı gönderdik.
          Gelen kutunuzu kontrol edin.
        </p>
        <a href="/giris" className="mt-6 inline-block text-sm font-medium text-neutral-900 hover:underline">
          Giriş sayfasına dön
        </a>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
      <h1 className="text-xl font-semibold text-neutral-900 mb-2">Şifremi Unuttum</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Kayıtlı e-posta adresinizi girin. Şifre sıfırlama bağlantısı göndereceğiz.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-neutral-700 mb-1">
            E-posta
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
          {loading ? 'Gönderiliyor...' : 'Sıfırlama Bağlantısı Gönder'}
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
