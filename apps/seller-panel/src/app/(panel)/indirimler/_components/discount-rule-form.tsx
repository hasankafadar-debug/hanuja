'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hanuja/ui'

interface CategoryOption {
  id: string
  name: string
}

interface ProductOption {
  id: string
  name: string
}

interface InitialRule {
  id: string
  name: string
  type: 'PERCENT' | 'FIXED_AMOUNT'
  scope: 'ALL_PRODUCTS' | 'CATEGORY' | 'PRODUCT'
  value: number
  categoryId?: string | null
  productIds?: string[]
  startsAt?: string | undefined
  endsAt?: string | undefined
}

interface DiscountRuleFormProps {
  categories: CategoryOption[]
  products: ProductOption[]
  initialRule?: InitialRule
}

function toDateTimeLocal(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function DiscountRuleForm({ categories, products, initialRule }: DiscountRuleFormProps) {
  const router = useRouter()
  const [name, setName] = useState(initialRule?.name ?? '')
  const [type, setType] = useState<'PERCENT' | 'FIXED_AMOUNT'>(initialRule?.type ?? 'PERCENT')
  const [scope, setScope] = useState<'ALL_PRODUCTS' | 'CATEGORY' | 'PRODUCT'>(initialRule?.scope ?? 'ALL_PRODUCTS')
  const [value, setValue] = useState(initialRule ? String(initialRule.value) : '')
  const [categoryId, setCategoryId] = useState(initialRule?.categoryId ?? '')
  const [productIds, setProductIds] = useState<string[]>(initialRule?.productIds ?? [])
  const [startsAt, setStartsAt] = useState(toDateTimeLocal(initialRule?.startsAt))
  const [endsAt, setEndsAt] = useState(toDateTimeLocal(initialRule?.endsAt))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = Boolean(initialRule)
  const hasInvalidDateRange = Boolean(startsAt && endsAt && new Date(startsAt) >= new Date(endsAt))
  const hasStartsInPast = !isEdit && Boolean(startsAt && new Date(startsAt) < new Date())
  const submitDisabled =
    loading ||
    !name.trim() ||
    !value ||
    hasInvalidDateRange ||
    hasStartsInPast ||
    (scope === 'CATEGORY' && !categoryId) ||
    (scope === 'PRODUCT' && productIds.length === 0)
  const missingSubmitReason = !name.trim()
    ? 'Indirimi kaydetmek icin kural adi girin.'
    : !value
      ? 'Indirimi kaydetmek icin indirim degerini girin.'
      : hasInvalidDateRange
        ? 'Baslangic tarihi bitis tarihinden once olmalidir.'
        : hasStartsInPast
          ? 'Baslangic tarihi gecmis bir zaman olamaz.'
          : scope === 'CATEGORY' && !categoryId
            ? 'Kategori kapsami icin kategori secin.'
            : scope === 'PRODUCT' && productIds.length === 0
              ? 'Urun kapsami icin en az bir urun secin.'
              : null

  function toggleProduct(productId: string, checked: boolean) {
    setProductIds((current) =>
      checked ? [...current, productId] : current.filter((id) => id !== productId),
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    if (hasInvalidDateRange) {
      setError('Baslangic tarihi bitis tarihinden once olmalidir.')
      setLoading(false)
      return
    }
    if (hasStartsInPast) {
      setError('Baslangic tarihi gecmis bir zaman olamaz.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(isEdit ? `/api/seller/discounts/${initialRule?.id}` : '/api/seller/discounts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          scope,
          value: Number(value),
          categoryId: scope === 'CATEGORY' ? categoryId : null,
          productIds: scope === 'PRODUCT' ? productIds : [],
          startsAt: startsAt ? new Date(startsAt).toISOString() : null,
          endsAt: endsAt ? new Date(endsAt).toISOString() : null,
        }),
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(payload.error ?? 'Indirim kaydedilemedi.')
        return
      }

      router.push('/indirimler')
      router.refresh()
    } catch {
      setError('Baglanti hatasi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">Kural Adi *</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Haftalik Bahar Indirimi" required disabled={loading} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="discount-type">Indirim Tipi</Label>
          <Select value={type} onValueChange={(next) => setType(next as typeof type)}>
            <SelectTrigger id="discount-type" aria-label="Indirim tipi" disabled={loading}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PERCENT">Yuzde</SelectItem>
              <SelectItem value="FIXED_AMOUNT">Tutar</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="discount-scope">Kapsam</Label>
          <Select value={scope} onValueChange={(next) => setScope(next as typeof scope)}>
            <SelectTrigger id="discount-scope" aria-label="Kapsam" disabled={loading}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL_PRODUCTS">Tum Urunler</SelectItem>
              <SelectItem value="CATEGORY">Kategori</SelectItem>
              <SelectItem value="PRODUCT">Urun</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="value">{type === 'PERCENT' ? 'Yuzde Degeri' : 'Tutar (TL)'}</Label>
          <Input id="value" type="number" min="0" step="0.01" max={type === 'PERCENT' ? '100' : undefined} value={value} onChange={(event) => setValue(event.target.value)} required disabled={loading} />
        </div>
      </div>

      {scope === 'CATEGORY' && (
        <div className="space-y-1.5">
          <Label htmlFor="discount-category">Kategori</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="discount-category" aria-label="Kategori" disabled={loading}>
              <SelectValue placeholder="Kategori secin" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {scope === 'PRODUCT' && (
        <div className="space-y-2">
          <Label>Urunler</Label>
          <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
            {products.map((product) => {
              const checked = productIds.includes(product.id)
              return (
                <label key={product.id} className="flex items-center gap-3 text-sm">
                  <Checkbox checked={checked} onCheckedChange={(next) => toggleProduct(product.id, Boolean(next))} />
                  <span>{product.name}</span>
                </label>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="startsAt">Baslangic</Label>
          <Input id="startsAt" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={loading} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="endsAt">Bitis</Label>
          <Input id="endsAt" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={loading} />
        </div>
      </div>

      {error && <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitDisabled} aria-describedby={missingSubmitReason ? 'discount-submit-hint' : undefined}>
          {loading ? 'Kaydediliyor...' : isEdit ? 'Indirimi Guncelle' : 'Indirimi Kaydet'}
        </Button>
      </div>
      {missingSubmitReason ? (
        <p id="discount-submit-hint" className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {missingSubmitReason}
        </p>
      ) : null}
    </form>
  )
}
