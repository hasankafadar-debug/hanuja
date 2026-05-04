'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface Props {
  reviewId: string
}

export default function ModerateActions({ reviewId }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  async function callModerate(decision: 'approved' | 'rejected', moderationNote?: string) {
    setError(null)
    setBusy(decision === 'approved' ? 'approve' : 'reject')
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          decision,
          ...(moderationNote ? { moderationNote } : {}),
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        setError(data?.message ?? 'İşlem başarısız')
        return
      }
      router.refresh()
    } catch {
      setError('Bağlantı hatası')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => callModerate('approved')}
        >
          {busy === 'approve' ? 'Onaylanıyor…' : 'Onayla'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => setShowRejectInput((v) => !v)}
        >
          Reddet
        </Button>
      </div>
      {showRejectInput && (
        <div className="space-y-2">
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Red gerekçesi (müşteriye iletilir)"
            className="w-full rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)' }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || rejectNote.trim().length === 0}
            onClick={() => callModerate('rejected', rejectNote.trim())}
          >
            {busy === 'reject' ? 'Reddediliyor…' : 'Reddi onayla'}
          </Button>
        </div>
      )}
      {error && (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}
    </div>
  )
}
