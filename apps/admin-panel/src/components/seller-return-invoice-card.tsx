'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { csrfFetch } from '@/lib/csrf-fetch'

type Invoice = {
  revision: string
  invoiceNumber: string
  invoiceDate: string
  fileName: string
}
export function SellerReturnInvoiceCard({
  returnId,
  sellerId,
  sellerName,
  invoice,
  amount,
  ready,
  message,
  vatGroups,
}: {
  sellerName: string
  returnId: string
  sellerId: string
  invoice: Invoice | null
  amount: string
  ready: boolean
  message: string | null
  vatGroups: Array<{
    taxRate: string
    amount: string
    netAmount: string
    vatAmount: string
  }>
}) {
  const router = useRouter()
  const [number, setNumber] = useState(invoice?.invoiceNumber ?? '')
  const [date, setDate] = useState(invoice?.invoiceDate.slice(0, 10) ?? '')
  const [reason, setReason] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const endpoint = `/api/admin/returns/${returnId}/seller-invoices/${sellerId}`
  async function save(remove = false) {
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setError('')
    try {
      const headers: Record<string, string> = invoice ? { 'If-Match': invoice.revision } : {}
      let body: FormData | string
      const method = remove ? 'DELETE' : file ? 'POST' : 'PATCH'
      if (file && !remove) {
        const form = new FormData()
        form.set('file', file)
        form.set('invoiceNumber', number)
        form.set('invoiceDate', date)
        form.set('reason', reason)
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify({
          invoiceNumber: number,
          invoiceDate: date,
          reason,
        })
      }
      const response = await csrfFetch(endpoint, { method, headers, body })
      const payload = await response.json()
      if (!response.ok)
        throw new Error(payload.message ?? payload.error?.message ?? 'Fatura kaydedilemedi.')
      setFile(null)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'İşlem başarısız.')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  return (
    <section
      aria-label={sellerName + ' iade faturası'}
      aria-busy={busy}
      className="space-y-3 rounded border p-4"
    >
      <h2 className="font-semibold">Hanuja → tasarımcı iade faturası</h2>
      <p className="font-medium">{sellerName}</p>
      <p>KDV dahil tutar: {amount} TL</p>
      {vatGroups.map((group) => (
        <p key={group.taxRate}>
          KDV %{Number(group.taxRate) * 100}: matrah {group.netAmount} TL · KDV {group.vatAmount} TL
        </p>
      ))}
      <p className="text-sm">
        Bu belge mevcut iade işlemine bağlanır; yeni hesap hareketi oluşturmaz.
      </p>
      {message ? <p role="status">{message}</p> : null}
      {invoice ? (
        <div className="flex gap-3">
          <a href={endpoint} target="_blank" rel="noreferrer" className="underline">
            Faturayı görüntüle
          </a>
          <a href={endpoint + '?download=1'} className="underline">
            İndir
          </a>
        </div>
      ) : (
        <p>İade faturası bekliyor.</p>
      )}
      <label className="block">
        Fatura numarası
        <input
          required
          maxLength={64}
          disabled={busy}
          className="block w-full rounded border p-2"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
      </label>
      <label className="block">
        Fatura tarihi
        <input
          required
          disabled={busy}
          type="date"
          className="block w-full rounded border p-2"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="block">
        PDF
        <input
          key={invoice?.revision ?? 'new'}
          disabled={busy}
          type="file"
          accept="application/pdf"
          className="block w-full"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {invoice ? (
        <label className="block">
          Düzeltme/kaldırma gerekçesi
          <input
            className="ml-2 rounded border p-2"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          disabled={
            busy ||
            !number ||
            !date ||
            (invoice && reason.trim().length < 5) ||
            (!invoice && (!file || !ready))
          }
          className="rounded border px-3 py-2 disabled:opacity-50"
          onClick={() => void save()}
        >
          Kaydet
        </button>
        {invoice ? (
          <button
            disabled={busy || reason.trim().length < 5}
            className="rounded border px-3 py-2 disabled:opacity-50"
            onClick={() => void save(true)}
          >
            Belgeyi kaldır
          </button>
        ) : null}
      </div>
    </section>
  )
}
