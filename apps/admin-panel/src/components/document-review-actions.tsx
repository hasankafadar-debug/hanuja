'use client'

/**
 * DocumentReviewActions — admin KYC belge onay/ret client component.
 * Approve için tek tıklama. Reject için zorunlu not girilmesi gerekir.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

type Props =
  | { documentId: string; groupId?: never }
  | { documentId?: never; groupId: string }

export function DocumentReviewActions({ documentId, groupId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(decision: 'approved' | 'rejected', note?: string) {
    setLoading(decision === 'approved' ? 'approve' : 'reject')
    setError(null)
    try {
      const endpoint = groupId
        ? `/api/admin/document-groups/${groupId}/review`
        : `/api/admin/documents/${documentId}/review`
      const res = await csrfFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.message ?? 'İşlem başarısız.')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata.')
    } finally {
      setLoading(null)
      setShowRejectForm(false)
      setRejectNote('')
    }
  }

  if (showRejectForm) {
    return (
      <div className="space-y-2">
        <textarea
          value={rejectNote}
          onChange={(e) => setRejectNote(e.target.value)}
          placeholder="Red gerekçesi (zorunlu)…"
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        {error && (
          <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!rejectNote.trim() || loading === 'reject'}
            onClick={() => submit('rejected', rejectNote.trim())}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-destructive)',
              color: '#fff',
            }}
          >
            {loading === 'reject' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Reddet
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRejectForm(false)
              setRejectNote('')
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{
              borderColor: 'var(--color-border)',
              border: '1px solid',
              color: 'var(--color-muted-fg)',
            }}
          >
            İptal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!!loading}
        onClick={() => submit('approved')}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-success)', color: '#fff' }}
      >
        {loading === 'approve' ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="h-3.5 w-3.5" />
        )}
        Onayla
      </button>
      <button
        type="button"
        disabled={!!loading}
        onClick={() => setShowRejectForm(true)}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--color-destructive) 12%, transparent)',
          color: 'var(--color-destructive)',
        }}
      >
        <XCircle className="h-3.5 w-3.5" />
        Reddet
      </button>
    </div>
  )
}
