'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type ActionKey = 'approve' | 'reject' | 'escalate' | 'seller'

export function AdminActions({
  requestId,
  requestedDays,
}: {
  requestId: string
  requestedDays: number
}) {
  const router = useRouter()
  const [active, setActive] = useState<ActionKey | null>(null)
  const [approvedDays, setApprovedDays] = useState<number>(requestedDays)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit(action: 'approve' | 'reject' | 'escalate_to_customer' | 'send_back_to_seller') {
    setError(null)

    const payload: Record<string, unknown> = { action }
    if (action === 'approve') {
      payload.approvedDays = approvedDays
      if (note.trim()) payload.adminNote = note.trim()
    } else if (action === 'reject' || action === 'send_back_to_seller') {
      if (!note.trim()) {
        setError('Açıklama gerekli.')
        return
      }
      payload.adminNote = note.trim()
    } else if (action === 'escalate_to_customer') {
      if (!note.trim()) {
        setError('Müşteriye yöneltilecek soru gerekli.')
        return
      }
      payload.questionForCustomer = note.trim()
    }

    const res = await fetch(`/api/admin/extension-requests/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json?.error?.message ?? 'İşlem başarısız.')
      return
    }

    setActive(null)
    setNote('')
    startTransition(() => router.refresh())
  }

  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
        Admin Aksiyonları
      </h3>

      {active === null ? (
        <div className="flex flex-wrap gap-2">
          <ActionButton onClick={() => setActive('approve')} primary>
            Kabul Et
          </ActionButton>
          <ActionButton onClick={() => setActive('escalate')}>Müşteriye Sor</ActionButton>
          <ActionButton onClick={() => setActive('seller')}>Satıcıdan Bilgi Bekle</ActionButton>
          <ActionButton onClick={() => setActive('reject')} danger>
            Reddet
          </ActionButton>
        </div>
      ) : (
        <div className="space-y-3">
          {active === 'approve' ? (
            <label className="block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Onaylanan İş Günü
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={approvedDays}
                onChange={(e) => setApprovedDays(Number(e.target.value))}
                className="w-32 rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              />
            </label>
          ) : null}

          <label className="block">
            <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
              {active === 'approve'
                ? 'Admin Notu (isteğe bağlı)'
                : active === 'reject'
                  ? 'Red Gerekçesi'
                  : active === 'escalate'
                    ? 'Müşteriye Soru'
                    : 'Satıcıdan İstenecek Bilgi'}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            />
          </label>

          {error ? (
            <p className="text-sm" style={{ color: 'var(--color-danger, #dc2626)' }}>
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setActive(null)
                setNote('')
                setError(null)
              }}
              disabled={pending}
              className="rounded-md border px-4 py-2 text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
            >
              Vazgeç
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (active === 'approve') submit('approve')
                else if (active === 'reject') submit('reject')
                else if (active === 'escalate') submit('escalate_to_customer')
                else submit('send_back_to_seller')
              }}
              className="rounded-md px-4 py-2 text-sm font-medium text-white"
              style={{
                backgroundColor:
                  active === 'reject'
                    ? 'var(--color-danger, #dc2626)'
                    : active === 'approve'
                      ? 'var(--color-success, #16a34a)'
                      : 'var(--color-primary)',
              }}
            >
              {pending ? 'Kaydediliyor…' : 'Onayla'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ActionButton({
  onClick,
  children,
  primary,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  primary?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-4 py-2 text-sm font-medium"
      style={{
        backgroundColor: primary
          ? 'var(--color-success, #16a34a)'
          : danger
            ? 'var(--color-danger, #dc2626)'
            : 'var(--color-surface)',
        color: primary || danger ? '#fff' : 'var(--color-primary)',
        border: primary || danger ? 'none' : '1px solid var(--color-border)',
      }}
    >
      {children}
    </button>
  )
}
