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

interface EditInvoiceDialogProps {
  invoiceId: string
  invoiceNumber: string
  invoiceDate: string
  invoiceCategory?: string | null
  description?: string | null
  grossInvoiceAmount: string
  type: 'commission' | 'penalty'
  disabled?: boolean
}

interface EditPenaltyDialogProps {
  penaltyId: string
  amount: string
  reason: string
  disabled?: boolean
}

function readError(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string') {
    return payload.message
  }
  return fallback
}

export function EditInvoiceDialog({
  invoiceId,
  invoiceNumber,
  invoiceDate,
  invoiceCategory,
  description,
  grossInvoiceAmount,
  type,
  disabled = false,
}: EditInvoiceDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    invoiceDate: invoiceDate.slice(0, 10),
    invoiceCategory: invoiceCategory ?? '',
    description: description ?? '',
    grossInvoiceAmount,
  })

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/seller-invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceDate: new Date(`${form.invoiceDate}T12:00:00.000Z`).toISOString(),
          invoiceCategory: form.invoiceCategory || null,
          description: form.description || null,
          grossInvoiceAmount: form.grossInvoiceAmount,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(readError(payload, 'Fatura guncellenemedi.'))
        return
      }

      setOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        Duzenle
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{type === 'commission' ? 'Komisyon Faturasini Duzenle' : 'Ceza Faturasini Duzenle'}</DialogTitle>
            <DialogDescription>
              Fatura numarasi sabittir: {invoiceNumber}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-date-${invoiceId}`}>Fatura Tarihi</Label>
              <Input
                id={`invoice-date-${invoiceId}`}
                type="date"
                value={form.invoiceDate}
                onChange={(event) => setForm((current) => ({ ...current, invoiceDate: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-category-${invoiceId}`}>Fatura Tipi</Label>
              <Input
                id={`invoice-category-${invoiceId}`}
                value={form.invoiceCategory}
                onChange={(event) => setForm((current) => ({ ...current, invoiceCategory: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-gross-${invoiceId}`}>KDV Dahil Tutar</Label>
              <Input
                id={`invoice-gross-${invoiceId}`}
                type="number"
                min="0"
                step="0.01"
                value={form.grossInvoiceAmount}
                onChange={(event) => setForm((current) => ({ ...current, grossInvoiceAmount: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-description-${invoiceId}`}>Aciklama</Label>
              <Textarea
                id={`invoice-description-${invoiceId}`}
                rows={4}
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </div>

            {error ? (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Vazgec
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function EditPenaltyDialog({
  penaltyId,
  amount,
  reason,
  disabled = false,
}: EditPenaltyDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ amount, reason })

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/admin/penalties/${penaltyId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: form.amount,
          reason: form.reason,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(readError(payload, 'Ceza guncellenemedi.'))
        return
      }

      setOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        Duzenle
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cezayi Duzenle</DialogTitle>
            <DialogDescription>
              Muaf tutulmamis aktif ceza kaydini gunceller.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`penalty-amount-${penaltyId}`}>Tutar</Label>
              <Input
                id={`penalty-amount-${penaltyId}`}
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`penalty-reason-${penaltyId}`}>Sebep</Label>
              <Textarea
                id={`penalty-reason-${penaltyId}`}
                rows={4}
                value={form.reason}
                onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))}
              />
            </div>

            {error ? (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Vazgec
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
