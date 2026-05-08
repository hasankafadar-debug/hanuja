'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label } from '@hanuja/ui'

interface PlatformSettingsValues {
  standardPenaltyRate: string
  fulfillmentDays: string
  fulfillmentWarningDays: string
  payoutHoldDays: string
  freeShippingThresholdTry: string
  flatShippingFeeTry: string
  defaultTaxRate: string
}

interface Props {
  initialValues: PlatformSettingsValues
}

function percentToDecimal(value: string) {
  return Number(value) / 100
}

function decimalToPercent(value: string) {
  return String(Number(value) * 100)
}

export function PlatformSettingsForm({ initialValues }: Props) {
  const router = useRouter()
  const [values, setValues] = useState({
    ...initialValues,
    standardPenaltyRate: decimalToPercent(initialValues.standardPenaltyRate),
    defaultTaxRate: decimalToPercent(initialValues.defaultTaxRate),
  })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function update(key: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
  }

  async function save() {
    setLoading(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch('/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          standardPenaltyRate: percentToDecimal(values.standardPenaltyRate),
          fulfillmentDays: Number(values.fulfillmentDays),
          fulfillmentWarningDays: Number(values.fulfillmentWarningDays),
          payoutHoldDays: Number(values.payoutHoldDays),
          freeShippingThresholdTry: Number(values.freeShippingThresholdTry),
          flatShippingFeeTry: Number(values.flatShippingFeeTry),
          defaultTaxRate: percentToDecimal(values.defaultTaxRate),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Ayarlar kaydedilemedi.')
        return
      }

      setMessage('Ayarlar kaydedildi.')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  const fields: Array<{
    key: keyof typeof values
    label: string
    suffix: string
    step?: string
    min?: string
  }> = [
    { key: 'standardPenaltyRate', label: 'Varsayılan ceza oranı', suffix: '%', step: '0.01', min: '0' },
    { key: 'fulfillmentDays', label: 'Sevk süresi', suffix: 'gün', min: '1' },
    { key: 'fulfillmentWarningDays', label: 'Admin uyarı penceresi', suffix: 'gün kala', min: '1' },
    { key: 'payoutHoldDays', label: 'Hakediş bekleme süresi', suffix: 'gün', min: '1' },
    { key: 'freeShippingThresholdTry', label: 'Ücretsiz kargo eşiği', suffix: 'TL', step: '0.01', min: '0' },
    { key: 'flatShippingFeeTry', label: 'Sabit kargo ücreti', suffix: 'TL', step: '0.01', min: '0' },
    { key: 'defaultTaxRate', label: 'Varsayılan KDV oranı', suffix: '%', step: '0.01', min: '0' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`platform-${field.key}`}>{field.label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`platform-${field.key}`}
                type="number"
                min={field.min}
                step={field.step ?? '1'}
                value={values[field.key]}
                onChange={(event) => update(field.key, event.target.value)}
              />
              <span className="w-16 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {field.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>

      {message ? <p className="text-sm" style={{ color: 'var(--color-success)' }}>{message}</p> : null}
      {error ? <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p> : null}

      <Button onClick={save} disabled={loading}>
        {loading ? 'Kaydediliyor...' : 'Ayarları Kaydet'}
      </Button>
    </div>
  )
}
