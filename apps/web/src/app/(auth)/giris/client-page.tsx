'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import { TurnstileWidget } from '@hanuja/ui'

type LoginPageClientProps = {
  turnstileSiteKey?: string | undefined
}

async function verifyTurnstile(token: string): Promise<string | null> {
  const res = await fetch('/api/turnstile-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action: 'customer-login' }),
  })
  if (res.ok) return null
  const data = (await res.json()) as { message?: string }
  return data.message ?? 'Güvenlik doğrulaması başarısız. Lütfen tekrar deneyin.'
}

export function LoginPageClient({ turnstileSiteKey }: LoginPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? searchParams.get('redirect') ?? '/hesabim'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)

  const handleTurnstileChange = useCallback((token: string) => {
    setTurnstileToken(token)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (turnstileSiteKey && !turnstileToken) {
      setError('Lütfen önce güvenlik doğrulamasını tamamlayın.')
      return
    }

    setLoading(true)

    try {
      if (turnstileSiteKey) {
        const verifyError = await verifyTurnstile(turnstileToken)
        if (verifyError) {
          setError(verifyError)
          setTurnstileKey((k) => k + 1)
          return
        }
      }

      const { error: authError } = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
      })

      if (authError) {
        setError('E-posta veya şifre hatalı.')
        setTurnstileKey((k) => k + 1)
        return
      }

      router.push(callbackUrl)
    } catch {
      setError('Giriş yapılamadı. Bağlantıyı kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
      <h1 className="text-xl font-semibold text-neutral-900 mb-6">Giriş Yap</h1>

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

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="password" className="block text-sm font-medium text-neutral-700">
              Şifre
            </label>
            <a href="/sifremi-unuttum" className="text-xs text-neutral-500 hover:text-neutral-900 transition">
              Şifremi unuttum
            </a>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10 transition"
          />
        </div>

        <TurnstileWidget
          key={turnstileKey}
          siteKey={turnstileSiteKey}
          action="customer-login"
          onChange={handleTurnstileChange}
        />

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={loading || (Boolean(turnstileSiteKey) && !turnstileToken)}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Hesabın yok mu?{' '}
        <a href="/kayit" className="font-medium text-neutral-900 hover:underline">
          Üye Ol
        </a>
      </p>
    </div>
  )
}
