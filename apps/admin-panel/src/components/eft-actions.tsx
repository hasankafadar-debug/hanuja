'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface EftActionsProps {
  orderId: string
}

export function EftActions({ orderId }: EftActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

  async function handle(action: 'approve' | 'reject') {
    setLoading(action)
    try {
      const body = action === 'reject' ? JSON.stringify({ reason: 'Dekont doğrulanamadı' }) : JSON.stringify({})
      await fetch(`/api/admin/payments/eft/${orderId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex gap-2 shrink-0">
      <Button size="sm" onClick={() => handle('approve')} disabled={loading !== null}>
        {loading === 'approve' ? '...' : 'Onayla'}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => handle('reject')}
        disabled={loading !== null}
      >
        {loading === 'reject' ? '...' : 'Reddet'}
      </Button>
    </div>
  )
}
