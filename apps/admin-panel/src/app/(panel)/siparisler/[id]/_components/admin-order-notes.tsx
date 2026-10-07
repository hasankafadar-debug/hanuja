'use client'

import { type FormEvent, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { csrfFetch } from '@/lib/csrf-fetch'

type Note = { id: string; body: string; createdAt: string; authorName: string }

export function AdminOrderNotes({ orderId, notes }: { orderId: string; notes: Note[] }) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const submitLock = useRef(false)
  const busy = saving || refreshing

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitLock.current || !body.trim()) return
    submitLock.current = true
    setSaving(true)
    setError(null)
    try {
      const response = await csrfFetch(`/api/admin/orders/${orderId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.message ?? 'Not kaydedilemedi. Lütfen tekrar deneyin.')
        return
      }
      setBody('')
      startTransition(() => router.refresh())
    } catch {
      setError('Bağlantı hatası oluştu. Yazdığınız not korunuyor.')
    } finally {
      submitLock.current = false
      setSaving(false)
    }
  }

  return (
    <section
      className="rounded-xl border p-5"
      data-testid="admin-order-notes"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
        Admin Notları
      </h2>
      <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Yalnızca adminler görebilir. Kaydedilen notlar korunur; düzeltmek için yeni not ekleyin.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-2">
        <label
          htmlFor="admin-order-note"
          className="block text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Yeni not
        </label>
        <textarea
          id="admin-order-note"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={5000}
          required
          disabled={busy}
          aria-describedby="admin-order-note-help"
          className="w-full rounded-lg border p-3 text-sm disabled:opacity-60"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span
            id="admin-order-note-help"
            className="text-xs"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            {body.length}/5000 karakter
          </span>
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            {busy ? 'Kaydediliyor…' : 'Not Ekle'}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        ) : null}
      </form>
      <div className="mt-5 space-y-4">
        {notes.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz admin notu yok.
          </p>
        ) : (
          notes.map((note) => (
            <article
              key={note.id}
              className="border-t pt-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <div
                className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                style={{ color: 'var(--color-muted-fg)' }}
              >
                <span className="font-medium">{note.authorName}</span>
                <time dateTime={note.createdAt}>
                  {new Date(note.createdAt).toLocaleString('tr-TR', {
                    timeZone: 'Europe/Istanbul',
                  })}
                </time>
              </div>
              <p
                className="whitespace-pre-wrap break-words text-sm"
                style={{ color: 'var(--color-primary)' }}
              >
                {note.body}
              </p>
            </article>
          ))
        )}
      </div>
    </section>
  )
}
