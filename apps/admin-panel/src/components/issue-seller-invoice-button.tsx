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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@hanuja/ui'

interface IssueSellerInvoiceButtonProps {
  sellerId: string
  type: 'commission' | 'penalty'
  sourceOrderId?: string
  sourcePenaltyId?: string
  orderNumber?: string
  defaultDescription: string
  defaultAmount: string
  buttonLabel: string
}

const INVOICE_CATEGORIES = ['e-Arsiv', 'e-Fatura', 'Diger']

export function IssueSellerInvoiceButton(props: IssueSellerInvoiceButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceCategory, setInvoiceCategory] = useState(INVOICE_CATEGORIES[0]!)
  const [description, setDescription] = useState(props.defaultDescription)
  const [amount, setAmount] = useState(props.defaultAmount)

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/seller-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId: props.sellerId,
          type: props.type,
          invoiceNumber,
          invoiceDate: new Date(`${invoiceDate}T12:00:00.000Z`).toISOString(),
          invoiceCategory,
          description,
          amount,
          ...(props.sourceOrderId ? { sourceOrderId: props.sourceOrderId } : {}),
          ...(props.sourcePenaltyId ? { sourcePenaltyId: props.sourcePenaltyId } : {}),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.error ?? 'Invoice could not be created.')
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
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {props.buttonLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{props.type === 'commission' ? 'Issue commission invoice' : 'Issue penalty invoice'}</DialogTitle>
            <DialogDescription>
              Record the invoice metadata for the seller finance timeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="invoice-date">Invoice date</Label>
                <Input id="invoice-date" type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-number">Invoice number</Label>
                <Input id="invoice-number" value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice type</Label>
                <Select value={invoiceCategory} onValueChange={setInvoiceCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVOICE_CATEGORIES.map((entry) => (
                      <SelectItem key={entry} value={entry}>{entry}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invoice-amount">Amount</Label>
                <Input id="invoice-amount" type="number" step="0.01" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="invoice-order-number">Order</Label>
                <Input id="invoice-order-number" value={props.orderNumber ?? '—'} readOnly />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invoice-description">Description</Label>
              <Textarea id="invoice-description" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>

            {error ? (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading}>
              {loading ? 'Saving...' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
