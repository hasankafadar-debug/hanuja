'use client'

import { useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from '@/lib/auth-client'
import { TurnstileWidget } from '@hanuja/ui'

type AuthClientError = {
  code?: string
  message?: string
  status?: number
}

type SellerLoginPageClientProps = {
  turnstileSiteKey?: string | undefined
}

function getSellerSignInErrorMessage(authError: AuthClientError | null | undefined): string {
  const message = authError?.message?.toLowerCase() ?? ''
  const code = authError?.code?.toLowerCase() ?? ''

  if (
    authError?.status === 500 ||
    authError?.status === 503 ||
    code.includes('database_unavailable') ||
    message.includes('database') ||
    message.includes('prisma') ||
    message.includes('connect')
  ) {
    return 'Satici girisi su anda gecici bir sunucu veya veritabani hatasi nedeniyle tamamlanamiyor. Lutfen seller panel servislerini kontrol edip tekrar deneyin.'
  }

  if (authError?.status === 401 || authError?.status === 403) {
    return 'E-posta veya sifre hatali.'
  }

  if (authError?.message) {
    return authError.message
  }

  return 'Giris yapilamadi. Lutfen tekrar deneyin.'
}

async function verifyTurnstile(token: string): Promise<string | null> {
  const res = await fetch('/api/turnstile-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action: 'seller-login' }),
  })
  if (res.ok) return null
  const data = (await res.json()) as { message?: string }
  return data.message ?? 'Guvenlik dogrulamasi basarisiz. Lutfen tekrar deneyin.'
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
      setError('Lutfen once guvenlik dogrulamasini tamamlayin.')
      return
    }

    setLoading(true)

    try {
      const verifyError = await verifyTurnstile(turnstileToken)
      if (verifyError) {
        setError(verifyError)
        setTurnstileKey((k) => k + 1)
        return
      }

      const { error: authError } = await signIn.email({
        email,
        password,
        callbackURL: callbackUrl,
      })

      if (authError) {
        setError(getSellerSignInErrorMessage(authError as AuthClientError))
        setTurnstileKey((k) => k + 1)
        return
      }

      router.push(callbackUrl)
    } catch {
      setError('Giris yapilamadi. Ag ve sunucu baglantisini kontrol edip tekrar deneyin.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Satici Girisi</h1>

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
            Sifre
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

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Giris yapiliyor...' : 'Giris Yap'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Satici hesabin yok mu?{' '}
        <a href="/basvuru" className="font-medium text-neutral-900 hover:underline">
          Magaza basvurusu yap
        </a>
      </p>

      <p className="mt-3 text-center text-sm text-neutral-500">
        <a href="/sifremi-unuttum" className="font-medium text-neutral-900 hover:underline">
          Sifrenizi mi unuttunuz?
        </a>
      </p>
    </div>
  )
}
