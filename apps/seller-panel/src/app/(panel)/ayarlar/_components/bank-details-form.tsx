'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Textarea } from '@hanuja/ui'
import { ShieldAlert, Clock3 } from 'lucide-react'

interface PendingRequest {
  id: string
  ibanMasked: string
  bankName: string
  activatesAt: string | null
  blockedReason: string | null
  flags: unknown
}

interface HistoryItem {
  id: string
  action: string
  ibanMasked: string
  previousIbanMasked: string | null
  createdAt: string
  reason: string | null
}

interface Props {
  currentIban: string
  currentAccountHolder: string
  currentBankName: string
  isVerified: boolean
  userEmail: string
  pendingRequest: PendingRequest | null
  history: HistoryItem[]
}

const ACTION_LABELS: Record<string, string> = {
  submitted: 'Talep oluşturuldu',
  approved: 'Admin onayı',
  activated: 'Aktifleşti',
  cancelled: 'İptal edildi',
  blocked: 'Bloklandı',
}

export default function BankDetailsForm({
  currentIban,
  currentAccountHolder,
  currentBankName,
  isVerified,
  userEmail,
  pendingRequest,
  history,
}: Props) {
  const router = useRouter()
  const [iban, setIban] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [bankName, setBankName] = useState('')
  const [reason, setReason] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [stepUpLoading, setStepUpLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [otpSent, setOtpSent] = useState(false)

  async function requestOtp() {
    setStepUpLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/seller/bank-details/step-up/request', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Doğrulama kodu gönderilemedi.')
      } else {
        setOtpSent(true)
        setSuccess(data.message ?? 'Doğrulama kodu gönderildi.')
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setStepUpLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/seller/bank-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          iban: iban.replace(/\s+/g, ''),
          accountHolder,
          bankName,
          otpCode,
          reason,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Bir hata oluştu.')
      } else {
        setSuccess(data.message ?? 'Talep alındı.')
        setIban('')
        setAccountHolder('')
        setBankName('')
        setReason('')
        setOtpCode('')
        setOtpSent(false)
        router.refresh()
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  async function cancelPending() {
    if (!pendingRequest) return
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const res = await fetch('/api/seller/bank-details/cancel-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankDetailId: pendingRequest.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Bekleyen kayıt iptal edilemedi.')
      } else {
        setSuccess('Bekleyen banka değişikliği iptal edildi.')
        router.refresh()
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
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#f59e0b' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: '#92400e' }}>Güvenlik Bildirimi</p>
          <p className="mt-0.5 text-xs" style={{ color: '#92400e' }}>
            Banka bilgisi değişikliği e-posta doğrulaması gerektirir ve 24 saat sonra aktifleşir.
            Bu sürede eski aktif IBAN kullanılmaya devam eder.
          </p>
        </div>
      </div>

      {currentIban && (
        <div
          className="rounded-xl border p-4 space-y-1"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
            Aktif Banka Bilgisi
          </p>
          <p className="text-sm font-mono" style={{ color: 'var(--color-primary)' }}>
            {currentIban}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {currentAccountHolder} · {currentBankName}
          </p>
          <p className="text-xs" style={{ color: isVerified ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {isVerified ? 'Doğrulanmış' : 'Doğrulama bekliyor'}
          </p>
        </div>
      )}

      {pendingRequest && (
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                Bekleyen Değişiklik
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {pendingRequest.ibanMasked} · {pendingRequest.bankName}
              </p>
            </div>
            <Clock3 className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            {pendingRequest.activatesAt
              ? `Aktifleşme: ${new Date(pendingRequest.activatesAt).toLocaleString('tr-TR')}`
              : 'Aktifleşme zamanı bekleniyor'}
          </p>
          {pendingRequest.blockedReason && (
            <p className="text-xs" style={{ color: 'var(--color-destructive)' }}>
              Blok nedeni: {pendingRequest.blockedReason}
            </p>
          )}
          <Button type="button" variant="outline" onClick={cancelPending} disabled={loading}>
            Bekleyen Değişikliği İptal Et
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="iban">Yeni IBAN</Label>
          <Input
            id="iban"
            value={iban}
            onChange={(e) => setIban(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            placeholder="TR000000000000000000000000"
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
        <div className="space-y-1.5">
          <Label htmlFor="reason">Değişiklik Sebebi</Label>
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Örn. kurumsal hesaba geçiş"
            disabled={loading}
          />
        </div>

        <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            E-posta doğrulama kodu {userEmail} adresine gönderilir.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={requestOtp} disabled={stepUpLoading}>
              {stepUpLoading ? 'Kod gönderiliyor...' : 'Doğrulama Kodu Gönder'}
            </Button>
            <Input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 haneli kod"
              disabled={loading}
            />
          </div>
          {otpSent && (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Kod gönderildi. 10 dakika içinde kullanın.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
        )}
        {success && (
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>{success}</p>
        )}

        <Button type="submit" variant="outline" disabled={loading || otpCode.length !== 6}>
          {loading ? 'Gönderiliyor...' : 'Değişiklik Talebi Oluştur'}
        </Button>
      </form>

      {history.length > 0 && (
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            Son Hareketler
          </p>
          <div className="mt-3 space-y-3">
            {history.map((entry) => (
              <div key={entry.id} className="border-t pt-3 first:border-t-0 first:pt-0" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  {ACTION_LABELS[entry.action] ?? entry.action}
                </p>
                <p className="text-xs font-mono" style={{ color: 'var(--color-muted-fg)' }}>
                  {entry.previousIbanMasked ? `${entry.previousIbanMasked} → ` : ''}
                  {entry.ibanMasked}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {new Date(entry.createdAt).toLocaleString('tr-TR')}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
