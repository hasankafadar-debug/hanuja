'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface ProductModerationActionsProps {
  productId: string
}

export function ProductModerationActions({ productId }: ProductModerationActionsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)

  async function handleApprove() {
    if (!confirm('Bu ürünü onaylamak istiyor musunuz?')) return
    setLoading('approve')
    try {
      await fetch(`/api/admin/products/${productId}/approve`, { method: 'POST' })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  async function handleReject() {
    const reason = prompt('Reddetme gerekçesi (isteğe bağlı):') ?? undefined
    setLoading('reject')
    try {
      await fetch(`/api/admin/products/${productId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={handleApprove} disabled={loading !== null}>
        {loading === 'approve' ? '...' : 'Onayla'}
      </Button>
      <Button size="sm" variant="destructive" onClick={handleReject} disabled={loading !== null}>
        {loading === 'reject' ? '...' : 'Reddet'}
      </Button>
    </div>
  )
}
