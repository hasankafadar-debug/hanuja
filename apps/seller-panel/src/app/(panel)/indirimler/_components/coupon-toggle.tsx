'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'

/**
 * Kupon aktif/pasif toggle — PATCH /api/seller/coupons/[id] isActive.
 * delete-discount-button.tsx deseni (client state + fetch + router.refresh).
 */
export function CouponToggle({ couponId, isActive }: { couponId: string; isActive: boolean }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle() {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/seller/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (response.ok) {
        router.refresh()
      } else {
        const payload = await response.json().catch(() => ({}))
        setError(payload.message ?? 'Kupon güncellenemedi.')
      }
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" size="sm" onClick={handleToggle} disabled={loading}>
        {loading ? '...' : isActive ? 'Pasife Al' : 'Aktif Et'}
      </Button>
      {error ? (
        <span className="text-xs" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
