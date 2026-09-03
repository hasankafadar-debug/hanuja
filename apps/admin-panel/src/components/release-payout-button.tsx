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

  async function handleRelease() {
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
          transferDate: new Date(`${transferDate}T12:00:00.000Z`).toISOString(),
          transferReference: transferReference.trim() || undefined,
          transferBankName: transferBankName.trim() || undefined,
          transferNote: transferNote.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(getApiErrorMessage(payload, 'Payment could not be recorded.'))
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Ode
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payout transfer</DialogTitle>
          <DialogDescription>
            Confirm the bank transfer details before moving this payout into the paid list.
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
              <Input id="payout-net-amount" value={netAmount} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-iban">IBAN</Label>
              <Input id="payout-iban" value={iban} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-account-holder">Account holder</Label>
              <Input id="payout-account-holder" value={accountHolder} readOnly />
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
          <Button onClick={() => void handleRelease()} disabled={loading}>
            {loading ? 'Saving...' : 'Save payout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
