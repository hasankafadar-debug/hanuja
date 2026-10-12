'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { csrfFetch } from '@/lib/csrf-fetch'

export function ExemptRowAction({ orderLineId }: { orderLineId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit() {
    setError(null)
    if (!reason.trim()) {
      setError('Muafiyet sebebi gerekli.')
      return
    }

    const res = await csrfFetch(`/api/admin/order-lines/${orderLineId}/commission-exempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json?.error?.message ?? 'Muafiyet kaydedilemedi.')
      return
    }

    setOpen(false)
    startTransition(() => router.refresh())
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
      >
        Muaf Et
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-full max-w-md rounded-xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
              Komisyon Muafiyeti
            </h3>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Muafiyet Sebebi
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                placeholder="Örn. promosyon kampanyası kapsamında..."
              />
            </label>

            {error ? (
              <p className="mb-3 text-sm" style={{ color: 'var(--color-danger, #dc2626)' }}>
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border px-4 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {pending ? 'Kaydediliyor…' : 'Muafiyeti Uygula'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
