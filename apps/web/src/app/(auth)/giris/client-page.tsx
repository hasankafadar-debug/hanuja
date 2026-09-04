'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import {
  getTurnstileClientErrorMessage,
  isDatabaseUnavailableError,
  type TurnstileClientError,
} from '@hanuja/security'
import { TurnstileWidget } from '@hanuja/ui'

type LoginPageClientProps = {
  turnstileSiteKey?: string | undefined
  googleLoginEnabled?: boolean
}

function getLoginErrorMessage(authError: TurnstileClientError | null | undefined): string {
  const turnstileMessage = getTurnstileClientErrorMessage(authError)
  if (turnstileMessage) return turnstileMessage

  if (isDatabaseUnavailableError(authError)) {
    return 'Giriş şu anda veritabanı bağlantısı nedeniyle kullanılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.status === 401 || authError?.status === 403) {
    return 'E-posta veya şifre hatalı.'
  }

  if (authError?.status === 500 || authError?.status === 503) {
    return 'Giriş hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  return authError?.message ?? 'Giriş yapılamadı. Lütfen tekrar deneyin.'
}

export function LoginPageClient({ turnstileSiteKey, googleLoginEnabled = false }: LoginPageClientProps) {
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

    if (!turnstileToken) {
      setError('Lütfen önce güvenlik doğrulamasını tamamlayın.')
      return
    }

    setLoading(true)

    try {
      const { error: authError } = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
        fetchOptions: { headers: { 'x-captcha-response': turnstileToken } },
      })

      if (authError) {
        setError(getLoginErrorMessage(authError as TurnstileClientError))
        setTurnstileToken('')
        setTurnstileKey((k) => k + 1)
        return
      }

      router.push(callbackUrl)
    } catch {
      setError('Giriş yapılamadı. Bağlantıyı kontrol edip tekrar deneyin.')
      setTurnstileToken('')
      setTurnstileKey((k) => k + 1)
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
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2.5 hover:bg-neutral-700 disabled:opacity-50 transition"
        >
          {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>

      {googleLoginEnabled ? (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-neutral-200" />
            <span className="text-xs text-neutral-400">veya</span>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>

          <button
            type="button"
            onClick={() => {
              void signIn.social({ provider: 'google', callbackURL: callbackUrl })
            }}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.616z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
              />
            </svg>
            Google ile giriş yap
          </button>
        </>
      ) : null}

      <p className="mt-6 text-center text-sm text-neutral-500">
        Hesabın yok mu?{' '}
        <a href="/kayit" className="font-medium text-neutral-900 hover:underline">
          Üye Ol
        </a>
      </p>
    </div>
  )
}
