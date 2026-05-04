'use client'

import { useMemo, useState, useTransition } from 'react'
import * as XLSX from 'xlsx'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@hanuja/ui'
import {
  BULK_UPDATE_TEMPLATE_HEADERS,
  MAX_BULK_UPDATE_ROWS,
  normalizeBulkProductUpdateRow,
  type BulkProductUpdateRow,
} from '@/lib/bulk-product-update'

interface UpdateResultRow {
  identifier: string
  status: 'matched' | 'not_found' | 'invalid' | 'noop' | 'updated'
  productName?: string
  oldPrice?: number
  newPrice?: number
  oldStock?: number
  newStock?: number
  message?: string
}

export function BulkUpdateForm() {
  const [rows, setRows] = useState<BulkProductUpdateRow[]>([])
  const [previewErrors, setPreviewErrors] = useState<Array<{ rowNumber: number; message: string }>>([])
  const [results, setResults] = useState<UpdateResultRow[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const previewRows = useMemo(() => results.slice(0, 12), [results])

  async function handleFileChange(file: File | null) {
    setSubmitError(null)
    setResults([])

    if (!file) {
      setRows([])
      setPreviewErrors([])
      setFileName(null)
      return
    }

    setFileName(file.name)

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]
      if (!firstSheetName) {
        setRows([])
        setPreviewErrors([{ rowNumber: 0, message: 'Calisma sayfasi bulunamadi.' }])
        return
      }

      const worksheet = workbook.Sheets[firstSheetName]
      if (!worksheet) {
        setRows([])
        setPreviewErrors([{ rowNumber: 0, message: 'Calisma sayfasi bulunamadi.' }])
        return
      }

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
      const headerRow = (XLSX.utils.sheet_to_json<string[]>(worksheet, { header: 1, range: 0 })[0] ?? []).map(
        String,
      )

      if (rawRows.length > MAX_BULK_UPDATE_ROWS) {
        setRows([])
        setPreviewErrors([
          { rowNumber: 0, message: `Bir seferde en fazla ${MAX_BULK_UPDATE_ROWS} satir yukleyebilirsiniz.` },
        ])
        return
      }

      const normalizedHeaders = new Set(headerRow.map((header) => header.toLowerCase()))
      if (!BULK_UPDATE_TEMPLATE_HEADERS.every((header) => normalizedHeaders.has(header.toLowerCase()))) {
        setRows([])
        setPreviewErrors([
          { rowNumber: 0, message: `Sablon sutunlari gerekli: ${BULK_UPDATE_TEMPLATE_HEADERS.join(', ')}` },
        ])
        return
      }

      const parsedRows = rawRows.map((row, index) => normalizeBulkProductUpdateRow(row, index + 2))
      setRows(parsedRows.flatMap((row) => (row.data ? [row.data] : [])))
      setPreviewErrors(
        parsedRows.flatMap((row) => row.errors.map((message) => ({ rowNumber: row.rowNumber, message }))),
      )
    } catch (error) {
      setRows([])
      setPreviewErrors([
        { rowNumber: 0, message: error instanceof Error ? error.message : 'Dosya okunamadi.' },
      ])
    }
  }

  function requestPreview() {
    if (rows.length === 0 || previewErrors.length > 0) return

    startTransition(async () => {
      const res = await fetch('/api/seller/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, apply: false }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        results?: UpdateResultRow[]
      }
      if (!res.ok) {
        setSubmitError(payload.error ?? 'Onizleme alinamadi.')
        return
      }
      setResults(payload.results ?? [])
    })
  }

  function applyUpdates() {
    if (rows.length === 0 || previewErrors.length > 0) return

    startTransition(async () => {
      const res = await fetch('/api/seller/products/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, apply: true }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string
        results?: UpdateResultRow[]
      }
      if (!res.ok) {
        setSubmitError(payload.error ?? 'Guncelleme uygulanamadi.')
        return
      }
      setResults(payload.results ?? [])
      setSubmitError(null)
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Toplu Fiyat / Stok Guncelle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-dashed p-6" style={{ borderColor: 'var(--color-border)' }}>
            <label htmlFor="bulk-update-file" className="sr-only">
              Guncelleme XLSX dosyasi
            </label>
            <input
              id="bulk-update-file"
              type="file"
              aria-label="Guncelleme XLSX dosyasi"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
            />
            <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              {fileName ? `${fileName} secildi` : 'XLSX dosyanizi secin. Maksimum 500 satir.'}
            </p>
          </div>

          <div className="rounded-xl border p-4 text-xs space-y-1" style={{ borderColor: 'var(--color-border)' }}>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Bu ekran yalnizca barkod ile calisir. SKU artik toplu guncellemede eslestirme icin kullanilmaz.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Sablonda <strong>Barkod*</strong> alanina 13 haneli barkod girin.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              href="/api/seller/products/bulk-update/template"
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              Sablon Indir
            </a>
            <Button
              type="button"
              variant="outline"
              onClick={requestPreview}
              disabled={isPending || rows.length === 0 || previewErrors.length > 0}
            >
              Onizleme Hazirla
            </Button>
            <Button
              type="button"
              onClick={applyUpdates}
              disabled={isPending || rows.length === 0 || previewErrors.length > 0}
            >
              Guncellemeyi Uygula
            </Button>
          </div>

          {submitError && (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {submitError}
            </p>
          )}
        </CardContent>
      </Card>

      {previewErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dosya Hatalari</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {previewErrors.map((error, index) => (
              <p
                key={`${error.rowNumber}-${index}`}
                className="text-sm"
                style={{ color: 'var(--color-destructive)' }}
              >
                Satir {error.rowNumber}: {error.message}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {previewRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Onizleme</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {['Barkod', 'Urun', 'Fiyat', 'Stok', 'Durum'].map((heading) => (
                      <th
                        key={heading}
                        className="border-b px-3 py-2 text-left"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => (
                    <tr key={`${row.identifier}-${index}`}>
                      <td className="border-b px-3 py-2 font-mono" style={{ borderColor: 'var(--color-border)' }}>
                        {row.identifier}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.productName ?? '-'}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.oldPrice !== undefined
                          ? `TL ${row.oldPrice.toLocaleString('tr-TR')} -> TL ${(row.newPrice ?? row.oldPrice).toLocaleString('tr-TR')}`
                          : '-'}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.oldStock !== undefined ? `${row.oldStock} -> ${row.newStock ?? row.oldStock}` : '-'}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.message ?? row.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
