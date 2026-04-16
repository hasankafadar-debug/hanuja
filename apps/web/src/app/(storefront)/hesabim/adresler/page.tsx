'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button, EmptyState, Spinner, Input, Label } from '@hanuja/ui'
import { MapPin, Plus, X } from 'lucide-react'

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

  function openNew() {
    setEditId(null)
    setForm(emptyForm)
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
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          addressLine2: form.addressLine2 || undefined,
          label: form.label || undefined,
        }),
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
      await fetch(`/api/user/addresses/${id}`, { method: 'DELETE' })
      await loadAddresses()
    } catch {
      setError('Adres silinemedi.')
    }
  }

  async function handleSetDefault(id: string) {
    try {
      await fetch(`/api/user/addresses/${id}`, { method: 'PUT' })
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1
          className="text-xl font-bold"
          style={{ color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}
        >
          Adreslerim
        </h1>
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Yeni Adres
        </Button>
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
              {editId ? 'Adresi Düzenle' : 'Yeni Adres Ekle'}
            </h2>
            <button onClick={() => setShowForm(false)}>
              <X className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="label">Adres Etiketi (İsteğe Bağlı)</Label>
              <Input
                id="label"
                placeholder="Ev, İş…"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Ad Soyad *</Label>
              <Input
                id="fullName"
                required
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
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
              <Label htmlFor="postalCode">Posta Kodu *</Label>
              <Input
                id="postalCode"
                maxLength={5}
                required
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
                Varsayılan adres olarak kaydet
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
            <Button size="sm" className="gap-1.5" onClick={openNew}>
              <Plus className="h-4 w-4" />
              Adres Ekle
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((addr) => (
            <div
              key={addr.id}
              className="rounded-xl border p-4"
              style={{
                borderColor: addr.isDefault ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
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
                </div>
                <div className="flex items-center gap-2">
                  {!addr.isDefault && (
                    <button
                      className="text-xs hover:underline"
                      style={{ color: 'var(--color-muted-fg)' }}
                      onClick={() => void handleSetDefault(addr.id)}
                    >
                      Varsayılan Yap
                    </button>
                  )}
                  <button
                    className="text-xs hover:underline"
                    style={{ color: 'var(--color-muted-fg)' }}
                    onClick={() => openEdit(addr)}
                  >
                    Düzenle
                  </button>
                  <button
                    className="text-xs hover:underline"
                    style={{ color: '#dc2626' }}
                    onClick={() => void handleDelete(addr.id)}
                  >
                    Sil
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                {addr.fullName} · {addr.phone}
                <br />
                {addr.addressLine1}
                {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                <br />
                {addr.district} / {addr.city} {addr.postalCode}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
