'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface ReturnReviewActionsProps {
  returnId: string
}

export function ReturnReviewActions({ returnId }: ReturnReviewActionsProps) {
  const router = useRouter()
  const [pending, setPending] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function review(decision: 'approved' | 'rejected') {
    setPending(decision)
    setError(null)

    try {
      const response = await csrfFetch(`/api/admin/returns/${returnId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        setError(payload.error ?? payload.message ?? 'Iade incelemesi kaydedilemedi.')
        return
      }

      router.refresh()
    } catch {
      setError('Baglanti hatasi olustu.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null}
          onClick={() => void review('approved')}
        >
          {pending === 'approved' ? 'Kaydediliyor...' : 'Onayla'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending !== null}
          onClick={() => void review('rejected')}
        >
          {pending === 'rejected' ? 'Kaydediliyor...' : 'Reddet'}
        </Button>
      </div>
      {error ? (
        <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
