'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface ReleasePayoutButtonProps {
  payoutId: string
}

export function ReleasePayoutButton({ payoutId }: ReleasePayoutButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleRelease() {
    if (!confirm('Bu hakedişi öde olarak işaretlemek istediğinize emin misiniz?')) return
    setLoading(true)
    try {
      await fetch(`/api/admin/payouts/${payoutId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Admin onayı ile serbest bırakıldı' }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleRelease} disabled={loading}>
      {loading ? '...' : 'Öde'}
    </Button>
  )
}
