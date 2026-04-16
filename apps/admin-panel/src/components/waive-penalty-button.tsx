'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

interface WaivePenaltyButtonProps {
  penaltyId: string
}

export function WaivePenaltyButton({ penaltyId }: WaivePenaltyButtonProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleWaive() {
    const reason = prompt('Muafiyet gerekçesini girin (en az 10 karakter):')
    if (!reason || reason.length < 10) return
    setLoading(true)
    try {
      await fetch(`/api/admin/penalties/${penaltyId}/waive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waiverReason: reason }),
      })
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button size="sm" variant="ghost" className="text-xs" onClick={handleWaive} disabled={loading}>
      {loading ? '...' : 'Muafiyet Uygula'}
    </Button>
  )
}
