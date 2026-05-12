'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Input, Label } from '@hanuja/ui'

interface Props {
  sellerId: string
  defaultRate: string
  overrideRate: string | null
}

function decimalToPercent(value: string | null) {
  if (value === null) return ''
  return String(Number(value) * 100)
}

export function SellerCommissionSettings({ sellerId, defaultRate, overrideRate }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(decimalToPercent(overrideRate))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const effectiveRateLabel = useMemo(() => {
    const active = overrideRate ?? defaultRate
    return `%${(Number(active) * 100).toFixed(2)}`
  }, [defaultRate, overrideRate])

  const sourceLabel = overrideRate === null ? 'Genel oran' : 'Ozel oran'

  async function save(nextValue: string | null) {
    setLoading(true)
    setError(null)

    try {
      const normalizedValue =
        nextValue === null || nextValue.trim() === '' ? null : nextValue.trim()

      const response = await fetch(`/api/admin/sellers/${sellerId}/commission`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commissionRateOverride:
            normalizedValue === null ? null : Number(normalizedValue) / 100,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Komisyon guncellenemedi.')
        return
      }

      router.refresh()
    } catch {
      setError('Baglanti hatasi olustu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Komisyon Orani
          </h3>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Etkin oran: {effectiveRateLabel}
          </p>
        </div>
        <Badge variant={overrideRate === null ? 'secondary' : 'success'}>{sourceLabel}</Badge>
      </div>

      <div className="mb-4 space-y-1.5">
        <Label htmlFor="seller-commission-override">Saticiya ozel komisyon (%)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="seller-commission-override"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <span className="w-10 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            %
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Bos birakirsaniz satici icin genel platform komisyonu kullanilir. 0 gecerli bir ozel
          orandir.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save(value)} disabled={loading}>
          {loading ? 'Kaydediliyor...' : 'Kaydet'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void save(null)} disabled={loading}>
          Ozel Orani Temizle
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
