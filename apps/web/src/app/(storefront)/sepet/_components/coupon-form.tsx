'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export default function CouponForm({
  couponCode,
  onUpdated,
}: {
  couponCode: string | null
  onUpdated: () => Promise<void>
}) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!error) return
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(null), 2000)
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [error])

  async function applyCoupon() {
    const normalizedCode = code.trim()
    if (!normalizedCode) {
      setError('Lütfen bir kupon kodu girin.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await csrfFetch('/api/cart/coupon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ couponCode: normalizedCode }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404 || body.code === 'NOT_FOUND') {
          setError('Girdiğiniz kod yanlıştır.')
        } else {
          setError('Kupon uygulanamadı.')
        }
        return
      }

      setCode('')
      await onUpdated()
    } catch {
      setError('Kupon uygulanamadı.')
    } finally {
      setLoading(false)
    }
  }

  async function removeCoupon() {
    setLoading(true)
    setError(null)

    try {
      const res = await csrfFetch('/api/cart/coupon', { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.message ?? 'Kupon kaldırılamadı.')
        return
      }

      await onUpdated()
    } catch {
      setError('Kupon kaldırılamadı.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
      {couponCode ? (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
              Aktif kupon
            </p>
            <p className="text-xs" style={{ color: 'var(--color-success)' }}>
              {couponCode}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void removeCoupon()}>
            Kaldır
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Kupon kodu"
            className="h-9 flex-1 rounded-lg border px-3 text-sm outline-none"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
            }}
          />
          <Button type="button" size="sm" disabled={loading} onClick={() => void applyCoupon()}>
            Uygula
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
