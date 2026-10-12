'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, InvoiceFileCard, Label, Textarea, type ManagedInvoiceFile } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export interface AdminSellerInvoice extends ManagedInvoiceFile {
  reviewStatus: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  invoiceNumber: string | null
  invoiceDate: string | null
}

export interface ExpectedPurchaseInvoice {
  amount: string
  vatGroups: Array<{ rate: string; net: string; vat: string }>
}

interface Props {
  orderId: string
  orderNumber: string
  sellerId: string
  sellerName: string
  invoice: AdminSellerInvoice | null
  expected: ExpectedPurchaseInvoice
  managementEnabled: boolean
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul',
  })
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
}

/**
 * The seller's invoice to Hanuja (satıcı Hanuja modeli). The admin checks amount, VAT rate
 * and order number against the PDF, then records the invoice number and date. The payout
 * term starts from that date; a rejection is shown to the seller with its reason.
 */
export function AdminInvoiceCard({
  orderId,
  orderNumber,
  sellerId,
  sellerName,
  invoice,
  expected,
  managementEnabled,
}: Props) {
  const router = useRouter()
  const id = useId()
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? '')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(decision: 'approve' | 'reject') {
    if (!invoice) return
    setPending(decision)
    setError(null)
    try {
      const res = await csrfFetch(`/api/admin/orders/${orderId}/invoices/${sellerId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': `"${invoice.revision}"` },
        body: JSON.stringify(
          decision === 'approve' ? { decision, invoiceNumber, invoiceDate } : { decision, note },
        ),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null
        setError(payload?.error ?? payload?.message ?? 'İşlem tamamlanamadı.')
        return
      }
      setNote('')
      router.refresh()
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>{sellerName}</h3>
        <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {!invoice
            ? 'Fatura bekleniyor'
            : invoice.reviewStatus === 'approved'
              ? 'Onaylandı'
              : invoice.reviewStatus === 'rejected'
                ? 'Reddedildi'
                : 'Onay bekliyor'}
        </span>
      </div>

      <div className="rounded-md px-3 py-2 text-sm" style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-primary)' }}>
        <p>Beklenen fatura tutarı (KDV dahil): <strong>{expected.amount}</strong></p>
        {expected.vatGroups.map((group) => (
          <p key={group.rate} className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            KDV {group.rate}: matrah {group.net} · KDV {group.vat}
          </p>
        ))}
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Kontrol: alıcı Hanuja unvanı, tutar, KDV oranı ve açıklamada sipariş numarası ({orderNumber}).
        </p>
      </div>

      <InvoiceFileCard
        endpoint={`/api/admin/orders/${orderId}/invoices/${sellerId}`}
        invoice={invoice}
        request={csrfFetch}
        onChanged={() => router.refresh()}
        canEdit
        allowUpload={managementEnabled}
        allowDelete={managementEnabled}
      />

      {invoice?.reviewStatus === 'approved' ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Fatura No: <strong style={{ color: 'var(--color-primary)' }}>{invoice.invoiceNumber}</strong>
          {invoice.invoiceDate ? ` · Fatura tarihi: ${formatDay(invoice.invoiceDate)}` : null}
        </p>
      ) : null}
      {invoice?.reviewStatus === 'rejected' && invoice.reviewNote ? (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Red gerekçesi: {invoice.reviewNote}</p>
      ) : null}

      {invoice && invoice.reviewStatus !== 'approved' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${id}-number`}>Fatura numarası</Label>
            <Input id={`${id}-number`} value={invoiceNumber} maxLength={64}
              onChange={(event) => setInvoiceNumber(event.target.value)} />
            <Label htmlFor={`${id}-date`}>Fatura tarihi</Label>
            <Input id={`${id}-date`} type="date" value={invoiceDate} max={todayInIstanbul()}
              onChange={(event) => setInvoiceDate(event.target.value)} />
            <Button type="button" size="sm" disabled={pending !== null || !invoiceNumber.trim() || !invoiceDate}
              onClick={() => submit('approve')}>
              {pending === 'approve' ? 'Onaylanıyor…' : 'Faturayı onayla'}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-note`}>Red gerekçesi (tasarımcıya gösterilir)</Label>
            <Textarea id={`${id}-note`} rows={3} value={note} maxLength={1000}
              onChange={(event) => setNote(event.target.value)} />
            <Button type="button" size="sm" variant="outline" disabled={pending !== null || note.trim().length < 5}
              onClick={() => submit('reject')}>
              {pending === 'reject' ? 'Gönderiliyor…' : 'Reddet'}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>{error}</p> : null}
    </div>
  )
}
