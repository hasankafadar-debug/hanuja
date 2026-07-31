'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button, EmptyState, Spinner, Input, Label } from '@hanuja/ui'
import { MapPin, Plus, X, FileText } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

type InvoiceType = 'individual' | 'corporate'

interface Address {
  id: string
  label: string | null
  fullName: string
  phone: string
  addressLine1: string
  addressLine2: string | null
  district: string
  city: string
  postalCode: string
  isDefault: boolean
  isBillingAddress: boolean
  invoiceType: InvoiceType | null
  tcNumber: string | null
  isForeignNational: boolean
  companyName: string | null
  taxOffice: string | null
  taxNumber: string | null
}

const emptyForm = {
  label: '',
  fullName: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  district: '',
  city: '',
  postalCode: '',
  isDefault: false,
  isBillingAddress: false,
  invoiceType: 'individual' as InvoiceType,
  tcNumber: '',
  isForeignNational: false,
  companyName: '',
  taxOffice: '',
  taxNumber: '',
}

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAddresses = useCallback(async () => {
    try {
      const res = await fetch('/api/user/addresses')
      const body = await res.json()
      setAddresses(body.data ?? [])
    } catch {
      setError('Adresler yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAddresses()
  }, [loadAddresses])

  function openNew(billing = false) {
    setEditId(null)
    setForm({ ...emptyForm, isBillingAddress: billing })
    setError(null)
    setShowForm(true)
  }

  function openEdit(addr: Address) {
    setEditId(addr.id)
    setForm({
      label: addr.label ?? '',
      fullName: addr.fullName,
      phone: addr.phone,
      addressLine1: addr.addressLine1,
      addressLine2: addr.addressLine2 ?? '',
      district: addr.district,
      city: addr.city,
      postalCode: addr.postalCode,
      isDefault: addr.isDefault,
      isBillingAddress: addr.isBillingAddress,
      invoiceType: addr.invoiceType ?? 'individual',
      tcNumber: addr.tcNumber ?? '',
      isForeignNational: addr.isForeignNational,
      companyName: addr.companyName ?? '',
      taxOffice: addr.taxOffice ?? '',
      taxNumber: addr.taxNumber ?? '',
    })
    setError(null)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const url = editId ? `/api/user/addresses/${editId}` : '/api/user/addresses'
      const method = editId ? 'PATCH' : 'POST'
      const payload: Record<string, unknown> = {
        ...form,
        addressLine2: form.addressLine2 || undefined,
        label: form.label || undefined,
      }
      if (!form.isBillingAddress) {
        delete payload.invoiceType
        delete payload.tcNumber
        delete payload.isForeignNational
        delete payload.companyName
        delete payload.taxOffice
        delete payload.taxNumber
      }
      const res = await csrfFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.error ?? 'Kaydedilemedi.')
        return
      }
      setShowForm(false)
      await loadAddresses()
    } catch {
      setError('Sunucu hatası.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Bu adresi silmek istediğinizden emin misiniz?')) return
    try {
      await csrfFetch(`/api/user/addresses/${id}`, { method: 'DELETE' })
      await loadAddresses()
    } catch {
      setError('Adres silinemedi.')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await csrfFetch(`/api/user/addresses/${id}`, { method: 'PUT' })
      await loadAddresses()
    } catch {
      setError('Varsayılan adres değiştirilemedi.')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  const shippingAddresses = addresses.filter((a) => !a.isBillingAddress)
  const billingAddresses = addresses.filter((a) => a.isBillingAddress)

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1
          className="text-xl font-medium"
          style={{ color: '#3d3529', fontFamily: 'var(--font-display)' }}
        >
          Adreslerim
        </h1>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openNew(true)}>
            <FileText className="h-4 w-4" />
            Yeni Fatura Adresi
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => openNew(false)}>
            <Plus className="h-4 w-4" />
            Yeni Adres
          </Button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg px-4 py-2 text-sm" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
          {error}
        </p>
      )}

      {/* Address form */}
      {showForm && (
        <div
          className="mb-6 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
              {editId
                ? form.isBillingAddress
                  ? 'Fatura Adresini Düzenle'
                  : 'Adresi Düzenle'
                : form.isBillingAddress
                  ? 'Yeni Fatura Adresi Ekle'
                  : 'Yeni Adres Ekle'}
            </h2>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">

            {/* Fatura adresi ise fatura tipi seçici */}
            {form.isBillingAddress && (
              <div className="sm:col-span-2">
                <Label className="mb-1.5 block">Fatura Türü *</Label>
                <div className="flex gap-3">
                  {(['individual', 'corporate'] as const).map((type) => (
                    <label
                      key={type}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
                      style={{
                        borderColor: form.invoiceType === type ? 'var(--color-accent)' : 'var(--color-border)',
                        backgroundColor: form.invoiceType === type ? 'var(--color-accent)' : 'var(--color-surface)',
                        color: form.invoiceType === type ? '#fff' : 'var(--color-primary)',
                      }}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name="invoiceType"
                        value={type}
                        checked={form.invoiceType === type}
                        onChange={() => setForm((f) => ({ ...f, invoiceType: type }))}
                      />
                      {type === 'individual' ? 'Bireysel' : 'Kurumsal'}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Kurumsal: Ünvan */}
            {form.isBillingAddress && form.invoiceType === 'corporate' && (
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="companyName">Ünvan *</Label>
                <Input
                  id="companyName"
                  required
                  placeholder="Örn: Suat Deri Ltd. Şti."
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                />
              </div>
            )}

            {/* Kurumsal: Vergi Dairesi ve No */}
            {form.isBillingAddress && form.invoiceType === 'corporate' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="taxOffice">Vergi Dairesi *</Label>
                  <Input
                    id="taxOffice"
                    required
                    value={form.taxOffice}
                    onChange={(e) => setForm((f) => ({ ...f, taxOffice: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taxNumber">Vergi Numarası *</Label>
                  <Input
                    id="taxNumber"
                    required
                    maxLength={20}
                    value={form.taxNumber}
                    onChange={(e) => setForm((f) => ({ ...f, taxNumber: e.target.value }))}
                  />
                </div>
              </>
            )}

            {/* Bireysel: Ad Soyad (zorunlu zaten) ve TC No */}
            {(!form.isBillingAddress || form.invoiceType === 'individual') && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Ad Soyad *</Label>
                <Input
                  id="fullName"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </div>
            )}

            {form.isBillingAddress && form.invoiceType === 'individual' && (
              <div className="space-y-1.5">
                <Label htmlFor="tcNumber">TC Kimlik No{form.isForeignNational ? '' : ' *'}</Label>
                <Input
                  id="tcNumber"
                  required={!form.isForeignNational}
                  maxLength={11}
                  placeholder="11 haneli TC Kimlik No"
                  value={form.tcNumber}
                  onChange={(e) => setForm((f) => ({ ...f, tcNumber: e.target.value }))}
                  disabled={form.isForeignNational}
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs mt-1" style={{ color: 'var(--color-muted-fg)' }}>
                  <input
                    type="checkbox"
                    checked={form.isForeignNational}
                    onChange={(e) => setForm((f) => ({ ...f, isForeignNational: e.target.checked, tcNumber: e.target.checked ? '' : f.tcNumber }))}
                  />
                  TC vatandaşı değilim
                </label>
              </div>
            )}

            {/* Ortak Adres Alanları */}
            {!form.isBillingAddress && (
              <div className="space-y-1.5">
                <Label htmlFor="label">Adres Etiketi (İsteğe Bağlı)</Label>
                <Input
                  id="label"
                  placeholder="Ev, İş…"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </div>
            )}

            {/* Kurumsal: Ad Soyad alanı (yetkili kişi) */}
            {form.isBillingAddress && form.invoiceType === 'corporate' && (
              <div className="space-y-1.5">
                <Label htmlFor="fullNameCorp">Yetkili Ad Soyad *</Label>
                <Input
                  id="fullNameCorp"
                  required
                  value={form.fullName}
                  onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefon *</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="05XXXXXXXXX"
                required
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="addressLine1">Adres Satırı 1 *</Label>
              <Input
                id="addressLine1"
                required
                value={form.addressLine1}
                onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 space-y-1.5">
              <Label htmlFor="addressLine2">Adres Satırı 2</Label>
              <Input
                id="addressLine2"
                value={form.addressLine2}
                onChange={(e) => setForm((f) => ({ ...f, addressLine2: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="district">İlçe *</Label>
              <Input
                id="district"
                required
                value={form.district}
                onChange={(e) => setForm((f) => ({ ...f, district: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">Şehir *</Label>
              <Input
                id="city"
                required
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="postalCode">Posta Kodu (opsiyonel)</Label>
              <Input
                id="postalCode"
                maxLength={5}
                value={form.postalCode}
                onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2 self-end pb-1">
              <input
                type="checkbox"
                id="isDefault"
                checked={form.isDefault}
                onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
              />
              <Label htmlFor="isDefault" className="cursor-pointer">
                Varsayılan {form.isBillingAddress ? 'fatura adresi' : 'adres'} olarak kaydet
              </Label>
            </div>
            <div className="sm:col-span-2 flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                İptal
              </Button>
            </div>
          </form>
        </div>
      )}

      {addresses.length === 0 && !showForm ? (
        <EmptyState
          icon={<MapPin className="h-10 w-10" />}
          title="Kayıtlı adresiniz yok"
          description="Hızlı sipariş için adresinizi kaydedin."
          action={
            <Button size="sm" className="gap-1.5" onClick={() => openNew(false)}>
              <Plus className="h-4 w-4" />
              Adres Ekle
            </Button>
          }
        />
      ) : (
        <>
          {/* Teslimat adresleri */}
          {shippingAddresses.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-muted-fg)' }}>
                TESLİMAT ADRESLERİ
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {shippingAddresses.map((addr) => (
                  <AddressCard
                    key={addr.id}
                    addr={addr}
                    onEdit={openEdit}
                    onDelete={(id) => void handleDelete(id)}
                    onSetDefault={(id) => void handleSetDefault(id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fatura adresleri */}
          {billingAddresses.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-muted-fg)' }}>
                FATURA ADRESLERİ
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {billingAddresses.map((addr) => (
                  <AddressCard
                    key={addr.id}
                    addr={addr}
                    onEdit={openEdit}
                    onDelete={(id) => void handleDelete(id)}
                    onSetDefault={(id) => void handleSetDefault(id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AddressCard({
  addr,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  addr: Address
  onEdit: (addr: Address) => void
  onDelete: (id: string) => void
  onSetDefault: (id: string) => void
}) {
  const invoiceLabel =
    addr.invoiceType === 'corporate'
      ? `Kurumsal${addr.companyName ? ` · ${addr.companyName}` : ''}`
      : addr.invoiceType === 'individual'
        ? 'Bireysel'
        : null

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: addr.isDefault ? 'var(--color-accent)' : 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {addr.isBillingAddress ? (
            <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          ) : (
            <MapPin className="h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
          )}
          <span className="font-medium text-sm" style={{ color: 'var(--color-primary)' }}>
            {addr.label ?? addr.fullName}
          </span>
          {addr.isDefault && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}
            >
              Varsayılan
            </span>
          )}
          {addr.isBillingAddress && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-muted-fg)', border: '1px solid var(--color-border)' }}
            >
              Fatura
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {!addr.isDefault && (
            <button
              className="text-xs hover:underline"
              style={{ color: 'var(--color-muted-fg)' }}
              onClick={() => onSetDefault(addr.id)}
            >
              Varsayılan Yap
            </button>
          )}
          <button
            className="text-xs hover:underline"
            style={{ color: 'var(--color-muted-fg)' }}
            onClick={() => onEdit(addr)}
          >
            Düzenle
          </button>
          <button
            className="text-xs hover:underline"
            style={{ color: '#dc2626' }}
            onClick={() => onDelete(addr.id)}
          >
            Sil
          </button>
        </div>
      </div>
      <div className="mt-2 text-sm space-y-0.5" style={{ color: 'var(--color-muted-fg)' }}>
        {invoiceLabel && <p className="text-xs font-medium">{invoiceLabel}</p>}
        <p>
          {addr.fullName} · {addr.phone}
        </p>
        <p>
          {addr.addressLine1}
          {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
        </p>
        <p>{[addr.district, '/', addr.city, addr.postalCode].filter(Boolean).join(' ')}</p>
      </div>
    </div>
  )
}
