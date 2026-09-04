'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import { sellerSignInSessionPolicy } from '@/lib/seller-session-policy'
import {
  getTurnstileClientErrorMessage,
  isDatabaseUnavailableError,
  type TurnstileClientError,
} from '@hanuja/security'
import { TurnstileWidget } from '@hanuja/ui'

type SellerLoginPageClientProps = {
  turnstileSiteKey?: string | undefined
}

function getSellerSignInErrorMessage(authError: TurnstileClientError | null | undefined): string {
  const turnstileMessage = getTurnstileClientErrorMessage(authError)
  if (turnstileMessage) return turnstileMessage

  if (isDatabaseUnavailableError(authError)) {
    return 'Satıcı girişi şu anda veritabanı bağlantısı nedeniyle kullanılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.status === 401 || authError?.status === 403) {
    return 'E-posta veya şifre hatalı.'
  }

  if (authError?.status === 500 || authError?.status === 503) {
    return 'Satıcı giriş hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.message) {
    return authError.message
  }

  return 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}

export function SellerLoginPageClient({ turnstileSiteKey }: SellerLoginPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'

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

    if (!turnstileToken) {
      setError('Lütfen önce güvenlik doğrulamasını tamamlayın.')
      return
    }

    setLoading(true)

    try {
      const { data, error: authError } = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
        fetchOptions: { headers: { 'x-captcha-response': turnstileToken } },
        ...sellerSignInSessionPolicy,
      })

      if (authError) {
        setError(getSellerSignInErrorMessage(authError as TurnstileClientError))
        setTurnstileToken('')
        setTurnstileKey((k) => k + 1)
        return
      }

      router.push(
        (data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect
          ? '/iki-asamali-dogrulama?callbackUrl=' + encodeURIComponent(callbackUrl)
          : callbackUrl,
      )
    } catch {
      setError('Giriş yapılamadı. Ağ bağlantısını kontrol edip tekrar deneyin.')
      setTurnstileToken('')
      setTurnstileKey((k) => k + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Satıcı Girişi</h1>

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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-neutral-700">
            Şifre
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        <TurnstileWidget
          key={turnstileKey}
          siteKey={turnstileSiteKey}
          action="seller-login"
          onChange={handleTurnstileChange}
        />

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Satıcı hesabın yok mu?{' '}
        <a href="/basvuru" className="font-medium text-neutral-900 hover:underline">
          Başvuruyu başlat
        </a>
      </p>

      <p className="mt-3 text-center text-sm text-neutral-500">
        <a href="/sifremi-unuttum" className="font-medium text-neutral-900 hover:underline">
          Şifrenizi mi unuttunuz?
        </a>
      </p>
    </div>
  )
}
