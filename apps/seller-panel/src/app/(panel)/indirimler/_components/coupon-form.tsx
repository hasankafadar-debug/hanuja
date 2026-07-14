'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hanuja/ui'

type DiscountType = 'percentage' | 'fixed_amount'

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  const cryptoObj = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObj?.getRandomValues) {
    const buf = new Uint32Array(length)
    cryptoObj.getRandomValues(buf)
    for (let i = 0; i < length; i += 1) out += chars[buf[i]! % chars.length]
  } else {
    for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

/**
 * Satıcı kupon oluşturma formu — discount-rule-form.tsx deseni
 * (client state + fetch + router.push + router.refresh).
 * Kod normalize (uppercase), yüzde 1-100 doğrulaması, opsiyonel limit/tarih/min sepet.
 */
export function CouponForm() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [discountType, setDiscountType] = useState<DiscountType>('percentage')
  const [discountValue, setDiscountValue] = useState('')
  const [maxUsageTotal, setMaxUsageTotal] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [minCartTotal, setMinCartTotal] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const normalizedCode = code.trim().toUpperCase()
  const numericValue = Number(discountValue)
  const isPercent = discountType === 'percentage'
  const hasInvalidPercent = isPercent && discountValue !== '' && (numericValue < 1 || numericValue > 100)
  const hasExpiryInPast = Boolean(expiresAt && new Date(expiresAt) <= new Date())

  const submitDisabled =
    loading ||
    normalizedCode.length < 3 ||
    !discountValue ||
    numericValue <= 0 ||
    hasInvalidPercent ||
    hasExpiryInPast

  const hint = normalizedCode.length < 3
    ? 'Kupon kodu en az 3 karakter olmalı.'
    : !discountValue || numericValue <= 0
      ? 'İndirim değeri sıfırdan büyük olmalı.'
      : hasInvalidPercent
        ? 'Yüzde indirim 1 ile 100 arasında olmalı.'
        : hasExpiryInPast
          ? 'Son geçerlilik tarihi gelecekte olmalı.'
          : null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/seller/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: normalizedCode,
          discountType,
          discountValue: numericValue,
          maxUsageTotal: maxUsageTotal ? Number(maxUsageTotal) : null,
          minCartTotal: minCartTotal ? Number(minCartTotal) : null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 409) {
          setError('Bu kupon kodu zaten kullanımda.')
        } else {
          setError(payload.message ?? 'Kupon oluşturulamadı.')
        }
        return
      }

      router.push('/indirimler')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div
        className="rounded-xl p-4 text-sm"
        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
      >
        Kupon yalnız sizin ürünlerinizde geçerlidir ve indirim tutarı hakedişinizden düşülür.
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="coupon-code">Kupon Kodu *</Label>
        <div className="flex gap-2">
          <Input
            id="coupon-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="BAHAR10"
            maxLength={40}
            required
            disabled={loading}
          />
          <Button type="button" variant="outline" onClick={() => setCode(generateCode())} disabled={loading}>
            Otomatik Üret
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="coupon-type">İndirim Tipi</Label>
          <Select value={discountType} onValueChange={(next) => setDiscountType(next as DiscountType)}>
            <SelectTrigger id="coupon-type" aria-label="İndirim tipi" disabled={loading}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percentage">Yüzde</SelectItem>
              <SelectItem value="fixed_amount">Sabit Tutar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="coupon-value">{isPercent ? 'Yüzde Değeri (1-100)' : 'Tutar (TL)'}</Label>
          <Input
            id="coupon-value"
            type="number"
            min={isPercent ? '1' : '0'}
            max={isPercent ? '100' : undefined}
            step={isPercent ? '1' : '0.01'}
            value={discountValue}
            onChange={(event) => setDiscountValue(event.target.value)}
            required
            disabled={loading}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="coupon-max-usage">Adet Limiti</Label>
          <Input
            id="coupon-max-usage"
            type="number"
            min="1"
            step="1"
            value={maxUsageTotal}
            onChange={(event) => setMaxUsageTotal(event.target.value)}
            placeholder="Boş = sınırsız"
            disabled={loading}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="coupon-expires">Son Geçerlilik Tarihi</Label>
          <Input
            id="coupon-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            disabled={loading}
          />
        </div>
      </div>

      <div className="space-y-1.5 md:max-w-xs">
        <Label htmlFor="coupon-min-cart">Minimum Sepet Tutarı (TL)</Label>
        <Input
          id="coupon-min-cart"
          type="number"
          min="0"
          step="0.01"
          value={minCartTotal}
          onChange={(event) => setMinCartTotal(event.target.value)}
          placeholder="Opsiyonel"
          disabled={loading}
        />
      </div>

      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitDisabled} aria-describedby={hint ? 'coupon-submit-hint' : undefined}>
          {loading ? 'Kaydediliyor...' : 'Kuponu Oluştur'}
        </Button>
      </div>
      {hint ? (
        <p id="coupon-submit-hint" className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {hint}
        </p>
      ) : null}
    </form>
  )
}
