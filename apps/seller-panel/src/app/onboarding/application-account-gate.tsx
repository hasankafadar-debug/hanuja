'use client'

import { useCallback, useState } from 'react'
import { TurnstileWidget } from '@hanuja/ui'
import { authClient, signUp } from '@/lib/auth-client'

type AuthClientError = {
  message?: string | undefined
  status?: number
}

type ApplicationAccountGateProps = {
  email?: string | undefined
  turnstileSiteKey?: string | undefined
  verificationJustCompleted?: boolean
}

function getSignupErrorMessage(authError: AuthClientError | null | undefined): string {
  const message = authError?.message?.toLowerCase() ?? ''

  if (authError?.status === 422 || message.includes('already')) {
    return 'Bu e-posta adresi zaten kayıtlı. Mevcut hesabınızla giriş yapabilirsiniz.'
  }

  if (
    authError?.status === 500 ||
    authError?.status === 503 ||
    message.includes('database') ||
    message.includes('prisma') ||
    message.includes('connect')
  ) {
    return 'Kayıt hizmetine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.'
  }

  return authError?.message ?? 'Hesap oluşturulamadı. Lütfen tekrar deneyin.'
}

async function verifyTurnstile(token: string): Promise<string | null> {
  const response = await fetch('/api/turnstile-verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, action: 'seller-signup' }),
  })

  if (response.ok) return null

  const body = (await response.json()) as { message?: string }
  return body.message ?? 'Güvenlik doğrulaması tamamlanamadı. Lütfen tekrar deneyin.'
}

async function sendVerificationEmail(email: string) {
  return authClient.sendVerificationEmail({
    email,
    callbackURL: `${window.location.origin}/basvuru?verified=1`,
  })
}

export function ApplicationAccountGate({
  email: sessionEmail,
  turnstileSiteKey,
  verificationJustCompleted = false,
}: ApplicationAccountGateProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)

  const handleTurnstileChange = useCallback((token: string) => {
    setTurnstileToken(token)
  }, [])

  const pendingVerificationEmail = sessionEmail ?? verificationEmail

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < 8) {
      setError('Şifre en az 8 karakter olmalıdır.')
      return
    }

    if (password !== passwordConfirm) {
      setError('Şifreler eşleşmiyor.')
      return
    }

    if (!turnstileToken) {
      setError('Lütfen önce güvenlik doğrulamasını tamamlayın.')
      return
    }

    setLoading(true)

    try {
      const verificationError = await verifyTurnstile(turnstileToken)
      if (verificationError) {
        setError(verificationError)
        setTurnstileToken('')
        setTurnstileKey((value) => value + 1)
        return
      }

      const { error: authError } = await signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: `${window.location.origin}/basvuru`,
      })

      if (authError) {
        setError(getSignupErrorMessage(authError as AuthClientError))
        setTurnstileToken('')
        setTurnstileKey((value) => value + 1)
        return
      }

      const normalizedEmail = email.trim()
      setVerificationEmail(normalizedEmail)
      const result = await sendVerificationEmail(normalizedEmail)

      setVerificationMessage(
        result?.error
          ? 'Hesabınız oluşturuldu ancak doğrulama e-postası gönderilemedi. Aşağıdan tekrar deneyin.'
          : 'Hesabınız oluşturuldu. Doğrulama bağlantısı e-posta adresinize gönderildi.',
      )
    } catch (caughtError) {
      setError(
        getSignupErrorMessage({
          message: caughtError instanceof Error ? caughtError.message : undefined,
        }),
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleResendVerification() {
    if (!pendingVerificationEmail) return

    setResending(true)
    setError(null)

    try {
      const result = await sendVerificationEmail(pendingVerificationEmail)
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

  if (verificationJustCompleted && !sessionEmail) {
    return (
      <AccountCard title="E-posta adresiniz doğrulandı">
        <p className="text-sm leading-6 text-neutral-600">
          Doğrulama tamamlandı. Mağaza başvurunuza devam etmek için oluşturduğunuz hesapla giriş yapın.
        </p>
        <a
          href="/giris?callbackUrl=/basvuru"
          className="mt-6 block w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-neutral-700"
        >
          Giriş yaparak devam et
        </a>
      </AccountCard>
    )
  }

  if (pendingVerificationEmail) {
    return (
      <AccountCard title="E-posta doğrulaması gerekiyor">
        <p className="text-sm leading-6 text-neutral-600">
          <strong>{pendingVerificationEmail}</strong> adresine gönderilen bağlantıyı açın. Doğrulamadan sonra bu sayfaya dönerek başvuru formuna devam edebilirsiniz.
        </p>
        {verificationMessage ? (
          <p role="status" className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {verificationMessage}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
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
            href="/giris?callbackUrl=/basvuru"
            className="block text-center text-sm font-medium text-neutral-900 hover:underline"
          >
            Mevcut hesapla giriş yap
          </a>
        </div>
      </AccountCard>
    )
  }

  return (
    <AccountCard title="Mağaza başvurusunu başlatın">
      <p className="mb-6 text-sm leading-6 text-neutral-600">
        Başvuru formuna geçmeden önce müşteri hesabınızı oluşturun ve e-posta adresinizi doğrulayın.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Ad Soyad" id="seller-signup-name">
          <input
            id="seller-signup-name"
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </Field>
        <Field label="E-posta" id="seller-signup-email">
          <input
            id="seller-signup-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </Field>
        <Field label="Şifre" id="seller-signup-password">
          <input
            id="seller-signup-password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </Field>
        <Field label="Şifre Tekrar" id="seller-signup-password-confirm">
          <input
            id="seller-signup-password-confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10"
          />
        </Field>

        <TurnstileWidget
          key={turnstileKey}
          siteKey={turnstileSiteKey}
          action="seller-signup"
          onChange={handleTurnstileChange}
        />

        {error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading || !turnstileToken}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:opacity-50"
        >
          {loading ? 'Hesap oluşturuluyor...' : 'Hesap oluştur ve devam et'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-500">
        Zaten hesabınız var mı?{' '}
        <a href="/giris?callbackUrl=/basvuru" className="font-medium text-neutral-900 hover:underline">
          Giriş yapın
        </a>
      </p>
    </AccountCard>
  )
}

function AccountCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="mb-2 text-sm font-semibold text-neutral-900">Hanuja Satıcı Başvurusu</p>
        <h1 className="mb-3 text-2xl font-semibold text-neutral-900">{title}</h1>
        {children}
      </div>
    </main>
  )
}

function Field({
  children,
  id,
  label,
}: {
  children: React.ReactNode
  id: string
  label: string
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-700">
        {label}
      </label>
      {children}
    </div>
  )
}
