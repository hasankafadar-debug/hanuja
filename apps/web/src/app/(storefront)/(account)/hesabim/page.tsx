'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Label, Spinner } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface UserProfile {
  id: string
  name: string | null
  email: string
  image: string | null
}

export default function AccountProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({ name: '', email: '' })

  useEffect(() => {
    fetch('/api/user/profile')
      .then((r) => r.json())
      .then((data: { data: UserProfile }) => {
        setProfile(data.data)
        setForm({ name: data.data.name ?? '', email: data.data.email })
      })
      .catch(() => setError('Profil yüklenemedi.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await csrfFetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name }),
      })
      if (!res.ok) {
        const body = await res.json()
        setError(body.error ?? 'Kaydetme başarısız.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Sunucu hatası.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }

  if (!profile) {
    return <p style={{ color: 'var(--color-muted-fg)' }}>Oturum açmanız gerekiyor.</p>
  }

  return (
    <div>
      <h1
        className="mb-6 text-xl font-medium"
        style={{ color: '#3d3529', fontFamily: 'var(--font-display)' }}
      >
        Profil Bilgilerim
      </h1>

      {error && (
        <p className="mb-4 rounded-lg px-4 py-2 text-sm" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
          {error}
        </p>
      )}
      {success && (
        <p className="mb-4 rounded-lg px-4 py-2 text-sm" style={{ backgroundColor: '#dcfce7', color: '#16a34a' }}>
          Değişiklikler kaydedildi.
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor="name">Ad Soyad</Label>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            minLength={2}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">E-posta</Label>
          <Input id="email" type="email" value={form.email} disabled readOnly />
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            E-posta adresi değiştirilemez.
          </p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
        </Button>
      </form>
    </div>
  )
}
