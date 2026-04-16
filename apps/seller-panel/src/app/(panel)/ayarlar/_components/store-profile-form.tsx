'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea } from '@hanuja/ui'

interface Props {
  storeName: string
  bio: string
  phone: string
}

export default function StoreProfileForm({ storeName, bio, phone }: Props) {
  const router = useRouter()
  const [name, setName] = useState(storeName)
  const [bioText, setBioText] = useState(bio)
  const [phoneText, setPhoneText] = useState(phone)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/seller/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeName: name,
          bio: bioText,
          phone: phoneText,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Bir hata oluştu.')
      } else {
        setSaved(true)
        router.refresh()
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="storeName">Mağaza Adı</Label>
        <Input
          id="storeName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Telefon</Label>
        <Input
          id="phone"
          type="tel"
          value={phoneText}
          onChange={(e) => setPhoneText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="bio">Mağaza Açıklaması</Label>
        <Textarea
          id="bio"
          rows={4}
          value={bioText}
          onChange={(e) => setBioText(e.target.value)}
          disabled={loading}
        />
      </div>

      {error && (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      )}
      {saved && (
        <p className="text-sm" style={{ color: 'var(--color-success)' }}>✓ Kaydedildi.</p>
      )}

      <Button type="submit" disabled={loading}>
        {loading ? 'Kaydediliyor…' : 'Kaydet'}
      </Button>
    </form>
  )
}
