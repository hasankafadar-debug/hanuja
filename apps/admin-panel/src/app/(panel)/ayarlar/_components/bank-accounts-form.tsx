'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Plus, Trash2, Eye, EyeOff } from 'lucide-react'
import { Button, Input, Label } from '@hanuja/ui'

type BankAccount = {
  id: string
  accountHolder: string
  accountHolderNote: string | null
  bankName: string
  iban: string
  branchName: string | null
  displayOrder: number
  isActive: boolean
}

interface Props {
  initialAccounts: BankAccount[]
}

type FormRow = {
  accountHolder: string
  accountHolderNote: string
  bankName: string
  iban: string
  branchName: string
  displayOrder: string
}

const emptyRow = (): FormRow => ({
  accountHolder: '',
  accountHolderNote: '',
  bankName: '',
  iban: '',
  branchName: '',
  displayOrder: '0',
})

export function BankAccountsForm({ initialAccounts }: Props) {
  const router = useRouter()
  const [accounts, setAccounts] = useState<BankAccount[]>(initialAccounts)
  const [adding, setAdding] = useState(false)
  const [newRow, setNewRow] = useState<FormRow>(emptyRow())
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  function updateNew(key: keyof FormRow, value: string) {
    setNewRow((r) => ({ ...r, [key]: value }))
  }

  async function addAccount() {
    setError(null)
    if (!newRow.accountHolder || !newRow.bankName || !newRow.iban) {
      setError('Hesap adı, banka adı ve IBAN zorunludur.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountHolder: newRow.accountHolder,
          accountHolderNote: newRow.accountHolderNote || null,
          bankName: newRow.bankName,
          iban: newRow.iban.replace(/\s/g, '').toUpperCase(),
          branchName: newRow.branchName || null,
          displayOrder: Number(newRow.displayOrder) || 0,
        }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        setError(payload.error ?? 'Hesap eklenemedi.')
        return
      }
      const { data } = await res.json()
      setAccounts((prev) => [...prev, data])
      setNewRow(emptyRow())
      setAdding(false)
      setMessage('Hesap eklendi.')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(account: BankAccount) {
    setTogglingId(account.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bank-accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !account.isActive }),
      })
      if (!res.ok) {
        setError('Durum güncellenemedi.')
        return
      }
      const { data } = await res.json()
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? data : a)))
      setMessage(data.isActive ? 'Hesap aktifleştirildi.' : 'Hesap pasifleştirildi.')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setTogglingId(null)
    }
  }

  async function deleteAccount(id: string) {
    if (!confirm('Bu banka hesabını silmek istediğinizden emin misiniz?')) return
    setDeletingId(id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bank-accounts/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        setError('Hesap silinemedi.')
        return
      }
      setAccounts((prev) => prev.filter((a) => a.id !== id))
      setMessage('Hesap silindi.')
      router.refresh()
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      {accounts.length === 0 && !adding ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Henüz EFT banka hesabı tanımlanmamış.
        </p>
      ) : null}

      <div className="space-y-3">
        {accounts.map((account) => (
          <div
            key={account.id}
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between"
            style={{
              borderColor: 'var(--color-border)',
              opacity: account.isActive ? 1 : 0.55,
            }}
          >
            <div className="space-y-0.5">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                {account.bankName}
                {account.branchName ? ` — ${account.branchName}` : ''}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {account.accountHolder}
                {account.accountHolderNote ? (
                  <span className="ml-1 italic">({account.accountHolderNote})</span>
                ) : null}
              </p>
              <p className="font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {account.iban}
              </p>
              <p className="text-xs" style={{ color: account.isActive ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {account.isActive ? 'Aktif' : 'Pasif'}
                {' · Sıra: '}{account.displayOrder}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleActive(account)}
                disabled={togglingId === account.id}
              >
                {account.isActive ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
                {account.isActive ? 'Pasifleştir' : 'Aktifleştir'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteAccount(account.id)}
                disabled={deletingId === account.id}
                style={{ color: 'var(--color-destructive)', borderColor: 'var(--color-destructive)' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Sil
              </Button>
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div
          className="space-y-3 rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            Yeni Banka Hesabı
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Hesap Sahibi *</Label>
              <Input
                value={newRow.accountHolder}
                onChange={(e) => updateNew('accountHolder', e.target.value)}
                placeholder="Şirket / Kişi adı"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Banka Adı *</Label>
              <Input
                value={newRow.bankName}
                onChange={(e) => updateNew('bankName', e.target.value)}
                placeholder="Örn: Kuveyt Türk"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>IBAN *</Label>
              <Input
                value={newRow.iban}
                onChange={(e) => updateNew('iban', e.target.value)}
                placeholder="TR00 0000 0000 0000 0000 0000 00"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Şube Adı (opsiyonel)</Label>
              <Input
                value={newRow.branchName}
                onChange={(e) => updateNew('branchName', e.target.value)}
                placeholder="Şube adı"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Sıra</Label>
              <Input
                type="number"
                min="0"
                value={newRow.displayOrder}
                onChange={(e) => updateNew('displayOrder', e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Hesap Adı Notu (opsiyonel)</Label>
              <Input
                value={newRow.accountHolderNote}
                onChange={(e) => updateNew('accountHolderNote', e.target.value)}
                placeholder="Örn: Hesap adı dar ise baştan sığdığı kadar yazabilirsiniz"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={addAccount} disabled={saving} size="sm">
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setAdding(false); setNewRow(emptyRow()); setError(null) }}
            >
              İptal
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Hesap Ekle
        </Button>
      )}

      {message ? (
        <p className="text-sm" style={{ color: 'var(--color-success)' }}>{message}</p>
      ) : null}
      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p>
      ) : null}
    </div>
  )
}
