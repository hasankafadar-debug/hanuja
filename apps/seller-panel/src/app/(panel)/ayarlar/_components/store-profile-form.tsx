'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea } from '@hanuja/ui'

interface Props {
  storeName: string
  bio: string
  phone: string
  companyName: string
  legalAddress: string
  district: string
  city: string
  postalCode: string
  taxOffice: string
  taxNumber: string
  mersis: string
}

export default function StoreProfileForm({
  storeName,
  bio,
  phone,
  companyName,
  legalAddress,
  district,
  city,
  postalCode,
  taxOffice,
  taxNumber,
  mersis,
}: Props) {
  const router = useRouter()
  const [name, setName] = useState(storeName)
  const [bioText, setBioText] = useState(bio)
  const [phoneText, setPhoneText] = useState(phone)
  const [companyNameText, setCompanyNameText] = useState(companyName)
  const [legalAddressText, setLegalAddressText] = useState(legalAddress)
  const [districtText, setDistrictText] = useState(district)
  const [cityText, setCityText] = useState(city)
  const [postalCodeText, setPostalCodeText] = useState(postalCode)
  const [taxOfficeText, setTaxOfficeText] = useState(taxOffice)
  const [taxNumberText, setTaxNumberText] = useState(taxNumber)
  const [mersisText, setMersisText] = useState(mersis)
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
          companyName: companyNameText,
          legalAddress: legalAddressText,
          district: districtText,
          city: cityText,
          postalCode: postalCodeText,
          taxOffice: taxOfficeText,
          taxNumber: taxNumberText,
          mersis: mersisText,
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
        <Label htmlFor="companyName">Ticari Unvan</Label>
        <Input
          id="companyName"
          value={companyNameText}
          onChange={(e) => setCompanyNameText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="taxOffice">Vergi Dairesi</Label>
        <Input
          id="taxOffice"
          value={taxOfficeText}
          onChange={(e) => setTaxOfficeText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="taxNumber">Vergi No / TC Kimlik No</Label>
        <Input
          id="taxNumber"
          value={taxNumberText}
          onChange={(e) => setTaxNumberText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="mersis">MERSİS</Label>
        <Input
          id="mersis"
          value={mersisText}
          onChange={(e) => setMersisText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="legalAddress">Yasal Adres</Label>
        <Textarea
          id="legalAddress"
          rows={3}
          value={legalAddressText}
          onChange={(e) => setLegalAddressText(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="district">İlçe</Label>
          <Input
            id="district"
            value={districtText}
            onChange={(e) => setDistrictText(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="city">Şehir</Label>
          <Input
            id="city"
            value={cityText}
            onChange={(e) => setCityText(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Posta Kodu</Label>
          <Input
            id="postalCode"
            value={postalCodeText}
            onChange={(e) => setPostalCodeText(e.target.value)}
            disabled={loading}
          />
        </div>
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
