'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { twoFactor } from '@/lib/auth-client'

export function SellerTwoFactorClient() {
  const router = useRouter(); const params = useSearchParams()
  const [code, setCode] = useState(''); const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false); const [retryAfter, setRetryAfter] = useState(0)
  const [method, setMethod] = useState<'email' | 'totp'>('email')
  async function send() {
    setLoading(true); setError(null)
    try {
      const { error: sendError } = await twoFactor.sendOtp({})
      if (sendError) { setError('Kod gonderilemedi. Lutfen daha sonra tekrar deneyin.'); return }
      setRetryAfter(60)
    } finally { setLoading(false) }
  }
  useEffect(() => { void send() }, [])
  useEffect(() => { if (!retryAfter) return; const id = window.setInterval(() => setRetryAfter((s) => Math.max(0, s - 1)), 1000); return () => window.clearInterval(id) }, [retryAfter])
  async function verify(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null)
    try {
      const { error: verificationError } = method === 'totp'
        ? await twoFactor.verifyTotp({ code, trustDevice: false })
        : await twoFactor.verifyOtp({ code })
      if (verificationError) { setError('Kod gecersiz veya suresi dolmus.'); return }
      router.replace(params.get('callbackUrl') ?? '/dashboard')
    } finally { setLoading(false) }
  }
  return <form onSubmit={verify} className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm space-y-4">
    <h1 className="text-xl font-semibold">Iki asamali dogrulama</h1>
    <p className="text-sm text-neutral-600">{method === 'totp' ? 'Authenticator uygulamanizdaki 6 haneli kodu girin.' : 'E-posta adresinize gonderilen 6 haneli kodu girin.'}</p>
    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required className="w-full rounded-lg border px-3 py-2" />
    {error ? <p className="text-sm text-red-600">{error}</p> : null}
    <button disabled={loading || code.length !== 6} className="w-full rounded-lg bg-neutral-900 py-2.5 text-white disabled:opacity-50">Dogrula</button>
    {method === 'email' ? <button type="button" onClick={() => void send()} disabled={loading || retryAfter > 0} className="w-full text-sm underline disabled:no-underline disabled:opacity-50">{retryAfter ? `Tekrar gonder (${retryAfter} sn)` : 'Kodu tekrar gonder'}</button> : null}
    <button type="button" onClick={() => { setMethod((current) => current === 'email' ? 'totp' : 'email'); setError(null); setCode('') }} className="w-full text-sm underline">{method === 'email' ? 'Admin hesabi: authenticator kodu kullan' : 'E-posta kodu kullan'}</button>
  </form>
}
