'use client'

import { useCallback, useState } from 'react'
import { authClient, signUp } from '@/lib/auth-client'
import { csrfFetch } from '@/lib/csrf-fetch'
import { TurnstileWidget } from '@hanuja/ui'

type AuthClientError = {
  message?: string
  status?: number
}

type SignupPageClientProps = {
  turnstileSiteKey?: string | undefined
}

function getSignupErrorMessage(authError: AuthClientError | null | undefined): string {
  const message = authError?.message?.toLowerCase() ?? ''

  if (authError?.status === 422) {
    return 'Bu e-posta adresi zaten kayıtlı.'
  }

  if (
    authError?.status === 500 ||
    authError?.status === 503 ||
    message.includes('database') ||
    message.includes("can't reach database") ||
    message.includes('connect') ||
    message.includes('prisma')
  ) {
    return 'Kayıt hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  if (authError?.message) {
    return authError.message
  }

  return 'Kayıt sırasında bir hata oluştu. Lütfen tekrar deneyin.'
}

async function verifyTurnstile(token: string): Promise<string | null> {
  const res = await fetch('/api/turnstile-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action: 'customer-signup' }),
  })
  if (res.ok) return null
  const data = (await res.json()) as { message?: string }
  return data.message ?? 'Güvenlik doğrulaması başarısız. Lütfen tekrar deneyin.'
}

async function sendVerificationEmail(email: string) {
  return authClient.sendVerificationEmail({
    email,
    callbackURL: `${window.location.origin}/hesabim?verified=1`,
  })
}

export function SignupPageClient({ turnstileSiteKey }: SignupPageClientProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [marketingConsent, setMarketingConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [resending, setResending] = useState(false)

  const handleTurnstileChange = useCallback((token: string) => {
    setTurnstileToken(token)
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password !== passwordConfirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }

    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalıdır.')
      return
    }

    if (!turnstileToken) {
      setError('Lütfen önce güvenlik doğrulamasını tamamlayın.')
      return
    }

    setLoading(true)

    try {
      const verifyError = await verifyTurnstile(turnstileToken)
      if (verifyError) {
        setError(verifyError)
        setTurnstileToken('')
        return
      }

      const { error: authError } = await signUp.email({
        name,
        email,
        password,
        callbackURL: '/hesabim',
      })

      if (authError) {
        setError(getSignupErrorMessage(authError as AuthClientError))
        setTurnstileToken('')
        return
      }

      setVerificationEmail(email)

      // Fire-and-forget marketing opt-in. Requires an active session; if signup
      // gates on email verification without one, the write is skipped server-side
      // (401) and simply retried later from account settings. Never blocks signup.
      if (marketingConsent) {
        void csrfFetch('/api/user/marketing-consent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consented: true }),
        }).catch(() => {})
      }

      const verificationResult = await sendVerificationEmail(email)

      if (verificationResult?.error) {
        setVerificationMessage('Hesap oluşturuldu ancak doğrulama e-postası gönderilemedi. Aşağıdan tekrar deneyebilirsiniz.')
        return
      }

      setVerificationMessage('Hesabınız oluşturuldu. Doğrulama bağlantısı e-posta adresinize gönderildi.')
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Kayıt oluşturulamadı. Bağlantıyı kontrol edip tekrar deneyin.'
      setError(getSignupErrorMessage({ message }))
    } finally {
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    if (!verificationEmail) return

    setResending(true)
    setError(null)

    try {
      const result = await sendVerificationEmail(verificationEmail)

      if (result?.error) {
        setError(result.error.message ?? 'Doğrulama e-postası tekrar gönderilemedi.')
        return
      }

      setVerificationMessage('Doğrulama e-postası tekrar gönderildi.')
    } catch {
      setError('Doğrulama e-postası tekrar gönderilemedi. Lütfen biraz sonra yeniden deneyin.')
    } finally {
      setResending(false)
    }
  }

  if (verificationEmail) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <h1 className="mb-3 text-xl font-semibold text-neutral-900">E-posta Doğrulaması Gerekiyor</h1>
        <p className="text-sm leading-relaxed text-neutral-600">
          <strong>{verificationEmail}</strong> adresine bir doğrulama bağlantısı gönderdik. Linke tıkladıktan sonra hesabınızla giriş yapıp alışverişe devam edebilirsiniz.
        </p>

        {verificationMessage ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{verificationMessage}</p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={handleResendVerification}
            disabled={resending}
            className="w-full rounded-lg border border-neutral-300 px-4 py-2.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            {resending ? 'Tekrar gönderiliyor...' : 'Doğrulama e-postasını tekrar gönder'}
          </button>

          <a
            href="/giris"
            className="block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-neutral-700"
          >
            Giriş sayfasına git
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
      <h1 className="mb-6 text-xl font-semibold text-neutral-900">Üye Ol</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-neutral-700">
            Ad Soyad
          </label>
          <input
            id="name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

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
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
          <p className="mt-1 text-xs text-neutral-400">En az 8 karakter</p>
        </div>

        <div>
          <label htmlFor="passwordConfirm" className="mb-1 block text-sm font-medium text-neutral-700">
            Şifre Tekrar
          </label>
          <input
            id="passwordConfirm"
            type="password"
            required
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </div>

        <TurnstileWidget
          siteKey={turnstileSiteKey}
          action="customer-signup"
          onChange={handleTurnstileChange}
        />

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        ) : null}

        <div className="flex items-start gap-2">
          <input
            id="marketingConsent"
            type="checkbox"
            checked={marketingConsent}
            onChange={(event) => setMarketingConsent(event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
          <label htmlFor="marketingConsent" className="text-xs leading-relaxed text-neutral-500">
            Kampanya, indirim ve fırsatlardan e-posta ve SMS ile haberdar olmak istiyorum.
          </label>
        </div>

        <p className="text-xs leading-relaxed text-neutral-400">
          Üye olarak{' '}
          <a href="/kullanim-kosullari" className="underline hover:text-neutral-700">
            Kullanım Koşulları
          </a>{' '}
          ve{' '}
          <a href="/gizlilik-politikasi" className="underline hover:text-neutral-700">
            Gizlilik Politikası
          </a>{' '}
          metinlerini kabul etmiş olursunuz.
        </p>

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Hesap oluşturuluyor...' : 'Üye Ol'}
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
