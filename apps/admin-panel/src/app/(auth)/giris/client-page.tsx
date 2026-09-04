'use client'

import Link from 'next/link'
import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import { adminSignInSessionPolicy } from '@/lib/admin-session-policy'
import {
  getTurnstileClientErrorMessage,
  isDatabaseUnavailableError,
  type TurnstileClientError,
} from '@hanuja/security'
import { TurnstileWidget } from '@hanuja/ui'

type AdminLoginPageClientProps = {
  turnstileSiteKey?: string | undefined
}

function getAdminSignInErrorMessage(authError: TurnstileClientError | null | undefined): string {
  const turnstileMessage = getTurnstileClientErrorMessage(authError)
  if (turnstileMessage) return turnstileMessage

  if (isDatabaseUnavailableError(authError)) {
    return 'Admin girişi şu anda veritabanı bağlantısı nedeniyle kullanılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.status === 401 || authError?.status === 403) {
    return 'E-posta veya şifre hatalı.'
  }

  if (authError?.status === 500 || authError?.status === 503) {
    return 'Admin giriş hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.message) {
    return authError.message
  }

  return 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}

export function AdminLoginPageClient({ turnstileSiteKey }: AdminLoginPageClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(
    urlError === 'unauthorized' ? 'Bu panele erişim yetkiniz yok.' : null,
  )
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)

  const handleTurnstileChange = useCallback((token: string) => {
    setTurnstileToken(token)
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setAuthError(null)

    if (!turnstileToken) {
      setAuthError('Güvenlik doğrulaması zorunludur.')
      return
    }

    setLoading(true)

    try {
      const { data, error: signInError } = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
        fetchOptions: { headers: { 'x-captcha-response': turnstileToken } },
        ...adminSignInSessionPolicy,
      })

      if (signInError) {
        setAuthError(getAdminSignInErrorMessage(signInError as TurnstileClientError))
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
      setAuthError('Giriş yapılamadı. Ağ bağlantısını kontrol edip tekrar deneyin.')
      setTurnstileToken('')
      setTurnstileKey((k) => k + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Admin Girişi</h1>

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
            onChange={(event) => setEmail(event.target.value)}
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
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
          <div className="mt-2 text-right">
            <Link
              href="/sifremi-unuttum"
              className="text-sm font-medium text-neutral-600 transition hover:text-neutral-900 hover:underline"
            >
              Şifremi unuttum
            </Link>
          </div>
        </div>

        <TurnstileWidget
          key={turnstileKey}
          siteKey={turnstileSiteKey}
          action="admin-login"
          onChange={handleTurnstileChange}
        />

        {authError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{authError}</p>
        ) : null}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>
    </div>
  )
}
