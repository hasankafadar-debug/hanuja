'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signUp } from '@/lib/auth-client'

export default function KayitPage() {
  const router = useRouter()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== passwordConfirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }
    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalıdır.')
      return
    }

    setLoading(true)

    const { error: authError } = await signUp.email({
      name,
      email,
      password,
      callbackURL: '/hesabim',
    })

    if (authError) {
      if (authError.status === 422) {
        setError('Bu e-posta adresi zaten kayıtlı.')
      } else {
        setError('Kayıt sırasında bir hata oluştu. Lütfen tekrar deneyin.')
      }
      setLoading(false)
      return
    }

    router.push('/hesabim')
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
      <h1 className="text-xl font-semibold text-neutral-900 mb-6">Üye Ol</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-neutral-700 mb-1">
            Ad Soyad
          </label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

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

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-1">
            Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
          <p className="mt-1 text-xs text-neutral-400">En az 8 karakter</p>
        </div>

        <div>
          <label htmlFor="passwordConfirm" className="block text-sm font-medium text-neutral-700 mb-1">
            Şifre Tekrar
          </label>
          <input
            id="passwordConfirm"
            type="password"
            required
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <p className="text-xs text-neutral-400 leading-relaxed">
          Üye olarak{' '}
          <a href="/kullanim-kosullari" className="underline hover:text-neutral-700">Kullanım Koşulları</a>
          {' '}ve{' '}
          <a href="/gizlilik-politikasi" className="underline hover:text-neutral-700">Gizlilik Politikası</a>
          'nı kabul etmiş olursunuz.
        </p>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
        >
          {loading ? 'Hesap oluşturuluyor…' : 'Üye Ol'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Zaten hesabın var mı?{' '}
        <a href="/giris" className="font-medium text-neutral-900 hover:underline">
          Giriş Yap
        </a>
      </p>
    </div>
  )
}
