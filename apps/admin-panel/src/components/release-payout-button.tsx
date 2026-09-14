'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { getApiErrorMessage } from '@/lib/api-error'

interface ReleasePayoutButtonProps {
  payoutId: string
  orderNumber: string
  netAmount: string
  iban: string
  accountHolder: string
  defaultBankName: string
}

type PaymentContext = {
  ready: boolean
  reason: string | null
  amount: string
  currency: string
  snapshot: string
  bank: { iban: string; accountHolder: string; bankName: string } | null
}

export function ReleasePayoutButton({
  payoutId,
  orderNumber,
  netAmount,
  iban,
  accountHolder,
  defaultBankName,
}: ReleasePayoutButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transferDate, setTransferDate] = useState(new Date().toISOString().slice(0, 10))
  const [transferReference, setTransferReference] = useState('')
  const [transferBankName, setTransferBankName] = useState(defaultBankName)
  const [transferNote, setTransferNote] = useState('')
  const [context, setContext] = useState<PaymentContext | null>(null)

  async function openPayment() {
    setOpen(true)
    setLoading(true)
    setContext(null)
    setError(null)
    try {
      const response = await csrfFetch(`/api/admin/payouts/${payoutId}/release`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) { setError(getApiErrorMessage(payload, 'Ödeme bilgileri alınamadı.')); return }
      setContext(payload.data)
      setTransferBankName(payload.data.bank?.bankName ?? '')
      if (!payload.data.ready) setError(payload.data.reason || 'Hakediş ödemeye uygun değil.')
    } catch { setError('Ödeme bilgileri alınamadı. Tekrar deneyin.') }
    finally { setLoading(false) }
  }

  async function handleRelease() {
    if (!context?.ready || !context.bank) return
    if (!transferDate) {
      setError('Transfer date is required.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await csrfFetch(`/api/admin/payouts/${payoutId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedSnapshot: context.snapshot,
          transferDate: new Date(`${transferDate}T12:00:00.000Z`).toISOString(),
          transferReference: transferReference.trim() || undefined,
          transferBankName: transferBankName.trim() || undefined,
          transferNote: transferNote.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(getApiErrorMessage(payload, 'Payment could not be recorded.'))
        if (payload.code === 'PAYOUT_SNAPSHOT_CHANGED' && payload.details?.current) {
          setContext({ ...payload.details.current, ready: true, reason: null })
          setTransferBankName(payload.details.current.bank?.bankName ?? '')
        } else {
          setContext((current) => current ? { ...current, ready: false } : null)
        }
        router.refresh()
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => void openPayment()}>
        Ödeme kaydet
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Satıcı ödemesini kaydet</DialogTitle>
          <DialogDescription>
            Güncel tutarı ve banka hesabını kontrol ederek yaptığınız transferi kaydedin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="payout-order-number">Order</Label>
              <Input id="payout-order-number" value={orderNumber} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-net-amount">Net amount</Label>
              <Input id="payout-net-amount" value={context ? `${context.amount} ${context.currency}` : netAmount} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-iban">IBAN</Label>
              <Input id="payout-iban" value={context ? context.bank?.iban ?? 'Doğrulanmış hesap yok' : iban} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-account-holder">Account holder</Label>
              <Input id="payout-account-holder" value={context ? context.bank?.accountHolder ?? '—' : accountHolder} readOnly />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="transfer-date">Transfer date</Label>
              <Input
                id="transfer-date"
                type="date"
                value={transferDate}
                onChange={(event) => setTransferDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="transfer-reference">Transfer reference</Label>
              <Input
                id="transfer-reference"
                value={transferReference}
                onChange={(event) => setTransferReference(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="transfer-bank-name">Bank name</Label>
              <Input
                id="transfer-bank-name"
                value={transferBankName}
                onChange={(event) => setTransferBankName(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="transfer-note">Description</Label>
            <Textarea
              id="transfer-note"
              rows={4}
              value={transferNote}
              onChange={(event) => setTransferNote(event.target.value)}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={() => void handleRelease()} disabled={loading || !context?.ready}>
            {loading ? 'Kontrol ediliyor...' : 'Ödemeyi kaydet'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
