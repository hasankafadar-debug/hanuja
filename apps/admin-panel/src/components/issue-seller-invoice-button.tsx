'use client'

import { useId, useState } from 'react'
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
import { csrfFetch } from '@/lib/csrf-fetch'
import { SearchableDesignerSelect } from './searchable-designer-select'

interface IssueSellerInvoiceButtonProps {
  sellerId?: string
  sellers?: Array<{ id: string; name: string }>
  type: 'commission' | 'penalty' | 'additional'
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
  const formId = useId()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' }))
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceCategory, setInvoiceCategory] = useState(INVOICE_CATEGORIES[0]!)
  const [description, setDescription] = useState(props.defaultDescription)
  const [amount, setAmount] = useState(props.defaultAmount)
  const [sellerId, setSellerId] = useState(props.sellerId ?? '')
  const additional = props.type === 'additional'
  const canSubmit = Boolean(sellerId && invoiceNumber.trim() && invoiceDate && Number(amount) > 0 && (!additional || description.trim()))

  async function handleSubmit() {
    setLoading(true)
    setError(null)

    try {
      const response = await csrfFetch('/api/admin/seller-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerId,
          type: props.type,
          invoiceNumber,
          invoiceDate: new Date(`${invoiceDate}T12:00:00.000Z`).toISOString(),
          invoiceCategory,
          description,
          grossInvoiceAmount: amount,
          ...(props.sourceOrderId ? { sourceOrderId: props.sourceOrderId } : {}),
          ...(props.sourcePenaltyId ? { sourcePenaltyId: props.sourcePenaltyId } : {}),
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        setError(payload.message ?? 'Fatura kaydedilemedi. Alanları kontrol edin.')
        return
      }

      setOpen(false)
      setInvoiceNumber('')
      setDescription(props.defaultDescription)
      setAmount(props.defaultAmount)
      if (additional) router.push('/cezalar?tab=additional')
      router.refresh()
    } catch {
      setError('Fatura kaydedilemedi. Bağlantınızı kontrol edip tekrar deneyin.')
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
            <DialogTitle>{additional ? 'Ek Fatura Kaydet' : props.type === 'commission' ? 'Komisyon Faturası Kaydet' : 'Ceza Faturası Kaydet'}</DialogTitle>
            <DialogDescription>
              {additional ? 'Kestiğiniz faturayı kaydedin. KDV dahil toplam tasarımcı ekstresine borç olarak işlenir ve hakedişlerinden düşülür.' : 'Kestiğiniz faturayı mevcut ceza kaydına bağlayın. Aynı borç tekrar eklenmez.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!props.sellerId ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-seller`}>Tasarımcı</Label>
                <SearchableDesignerSelect id={`${formId}-seller`} sellers={props.sellers ?? []} value={sellerId} onChange={setSellerId} />
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-date`}>Fatura tarihi</Label>
                <Input id={`${formId}-date`} type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-number`}>Fatura numarası</Label>
                <Input id={`${formId}-number`} maxLength={120} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-category`}>Fatura tipi</Label>
                <Select value={invoiceCategory} onValueChange={setInvoiceCategory}>
                  <SelectTrigger id={`${formId}-category`}>
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
                <Label htmlFor={`${formId}-amount`}>Tutar (KDV dahil)</Label>
                <Input id={`${formId}-amount`} type="number" step="0.01" min="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
              {!additional ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${formId}-order`}>Sipariş</Label>
                <Input id={`${formId}-order`} value={props.orderNumber ?? '—'} readOnly />
              </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${formId}-description`}>Açıklama</Label>
              <Textarea id={`${formId}-description`} rows={4} maxLength={5000} placeholder={additional ? 'Örneğin: Fiyat farkı faturası' : undefined} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>

            {error ? (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Vazgeç
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
              {loading ? 'Kaydediliyor...' : 'Faturayı Kaydet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
