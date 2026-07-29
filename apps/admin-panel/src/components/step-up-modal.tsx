'use client'

import { useState } from 'react'
import { Button } from '@hanuja/ui'
import type { CriticalCapability } from '@hanuja/api/lib/auth-security'

export function StepUpModal({
  open,
  capability,
  onClose,
  onVerified,
}: {
  open: boolean
  capability: CriticalCapability | null
  onClose: () => void
  onVerified: (token: string) => void
}) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  if (!open || !capability) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError(null)
    try {
      const response = await fetch('/api/admin/security/step-up', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, capability }),
      })
      const payload = await response.json().catch(() => ({})) as { data?: { token?: string }; message?: string }
      if (!response.ok || !payload.data?.token) { setError(payload.message ?? 'Dogrulama kodu gecersiz.'); return }
      setCode(''); onVerified(payload.data.token)
    } finally { setLoading(false) }
  }

  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow-xl">
      <h2 className="text-lg font-semibold">Guvenlik dogrulamasi</h2>
      <p className="text-sm text-neutral-600">Bu kritik islemi tamamlamak icin authenticator uygulamanizdaki kodu girin.</p>
      <input autoFocus required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="w-full rounded border px-3 py-2" />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose} disabled={loading}>Vazgec</Button><Button type="submit" disabled={loading || code.length !== 6}>{loading ? 'Dogrulaniyor...' : 'Dogrula ve devam et'}</Button></div>
    </form>
  </div>
}
