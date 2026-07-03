'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function InvoiceRowAction({
  orderLineId,
  sellerId,
  orderId,
  commissionNet,
  orderPublicNumber,
}: {
  orderLineId: string
  sellerId: string
  orderId: string
  commissionNet: number
  orderPublicNumber: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10))
  // Admin enters the VAT-inclusive total; default is computed but editable.
  const defaultGross = Number((commissionNet * 1.2).toFixed(2))
  const [grossAmount, setGrossAmount] = useState<string>(defaultGross.toFixed(2))
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit() {
    setError(null)
    if (!invoiceNumber.trim()) {
      setError('Fatura numarası gerekli.')
      return
    }
    const parsedGross = Number.parseFloat(grossAmount.replace(',', '.'))
    if (!Number.isFinite(parsedGross) || parsedGross <= 0) {
      setError('Geçerli bir KDV dahil tutar girin.')
      return
    }

    const res = await fetch(`/api/admin/order-lines/${orderLineId}/commission-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: new Date(invoiceDate).toISOString(),
        description: description.trim() || undefined,
        sellerId,
        sourceOrderId: orderId,
        grossInvoiceAmount: parsedGross.toFixed(2),
      }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json?.error?.message ?? 'Fatura oluşturulamadı.')
      return
    }

    setOpen(false)
    startTransition(() => router.refresh())
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
      >
        Faturalandır
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-full max-w-md rounded-xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <h3 className="mb-1 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
              Komisyon Faturası Oluştur
            </h3>
            <p className="mb-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              {orderPublicNumber ? `Sipariş #${orderPublicNumber}` : 'Sipariş'} • Net Komisyon{' '}
              {commissionNet.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL{' '}
              <span className="font-medium">+ %20 KDV</span>
            </p>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Fatura Numarası
              </span>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                placeholder="HNJ-2026-..."
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Fatura Tarihi
              </span>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              />
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                KDV Dahil Tutar (TL) — fatura üzerinde yazan toplam
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={grossAmount}
                onChange={(e) => setGrossAmount(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                placeholder={defaultGross.toFixed(2)}
              />
              <span className="mt-1 block text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Önerilen: {defaultGross.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL (net{' '}
                {commissionNet.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL × 1,20)
              </span>
            </label>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Açıklama (isteğe bağlı)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              />
            </label>

            {error ? (
              <p className="mb-3 text-sm" style={{ color: 'var(--color-danger, #dc2626)' }}>
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border px-4 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {pending ? 'Kaydediliyor…' : 'Faturayı Kes'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export function ExemptRowAction({ orderLineId }: { orderLineId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function submit() {
    setError(null)
    if (!reason.trim()) {
      setError('Muafiyet sebebi gerekli.')
      return
    }

    const res = await fetch(`/api/admin/order-lines/${orderLineId}/commission-exempt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json?.error?.message ?? 'Muafiyet kaydedilemedi.')
      return
    }

    setOpen(false)
    startTransition(() => router.refresh())
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
      >
        Muaf Et
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className="w-full max-w-md rounded-xl p-6 shadow-xl"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            <h3 className="mb-3 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
              Komisyon Muafiyeti
            </h3>

            <label className="mb-3 block">
              <span className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                Muafiyet Sebebi
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                placeholder="Örn. promosyon kampanyası kapsamında..."
              />
            </label>

            {error ? (
              <p className="mb-3 text-sm" style={{ color: 'var(--color-danger, #dc2626)' }}>
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="rounded-md border px-4 py-2 text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {pending ? 'Kaydediliyor…' : 'Muafiyeti Uygula'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
