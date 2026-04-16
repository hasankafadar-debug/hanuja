'use client'

import { useState } from 'react'
import { Button, Input, Label } from '@hanuja/ui'
import { ShieldAlert } from 'lucide-react'

interface Props {
  currentIban: string
  currentAccountHolder: string
  currentBankName: string
  isVerified: boolean
}

export default function BankDetailsForm({
  currentIban,
  currentAccountHolder,
  currentBankName,
  isVerified,
}: Props) {
  const [iban, setIban] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/seller/bank-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iban, accountHolder, bankName }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Bir hata oluştu.')
      } else {
        setSuccess(data.message ?? 'Talep alındı.')
        setIban('')
        setAccountHolder('')
        setBankName('')
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div
        className="flex items-start gap-3 rounded-xl border p-4"
        style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb' }}
      >
        <ShieldAlert className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Güvenlik Bildirimi</p>
          <p className="text-xs mt-0.5" style={{ color: '#92400e' }}>
            Banka bilgisi değişikliği admin incelemesine alınır. Yeni IBAN aktif olmadan
            önceki IBAN kullanılmaya devam eder.
          </p>
        </div>
      </div>

      {/* Mevcut banka bilgisi */}
      {currentIban && (
        <div
          className="rounded-xl border p-4 space-y-1"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
            Mevcut Banka Bilgisi
          </p>
          <p className="text-sm font-mono" style={{ color: 'var(--color-primary)' }}>
            {currentIban}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {currentAccountHolder} — {currentBankName}
          </p>
          <p className="text-xs" style={{ color: isVerified ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {isVerified ? '✓ Doğrulanmış' : '⏳ Doğrulama bekleniyor'}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="iban">Yeni IBAN</Label>
          <Input
            id="iban"
            value={iban}
            onChange={(e) => setIban(e.target.value.toUpperCase())}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="accountHolder">Hesap Sahibi</Label>
          <Input
            id="accountHolder"
            value={accountHolder}
            onChange={(e) => setAccountHolder(e.target.value)}
            placeholder="Ad Soyad / Şirket Adı"
            required
            disabled={loading}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bankName">Banka Adı</Label>
          <Input
            id="bankName"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="Ziraat Bankası"
            required
            disabled={loading}
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
        )}
        {success && (
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>✓ {success}</p>
        )}

        <Button type="submit" variant="outline" disabled={loading}>
          {loading ? 'Gönderiliyor…' : 'Değişiklik Talebi Oluştur'}
        </Button>
      </form>
    </div>
  )
}
