'use client'

import { useMemo, useState, useTransition } from 'react'
import * as XLSX from 'xlsx'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@hanuja/ui'
import {
  BULK_PRODUCT_TEMPLATE_HEADERS,
  MAX_BULK_IMPORT_ROWS,
  getMissingBulkProductHeaders,
  normalizeBulkProductRow,
  type BulkProductImportRow,
} from '@/lib/bulk-product-import'

interface TemplateCategory {
  slug: string
  label: string
}

interface TemplateArea {
  slug: 'ev' | 'ofis'
  label: string
  categories: TemplateCategory[]
}

interface ImportError {
  rowNumber: number
  message: string
}

interface ImportResult {
  imported: number
  failed: number
  errors: ImportError[]
}

interface BulkImportFormProps {
  areas: TemplateArea[]
}

export function BulkImportForm({ areas }: BulkImportFormProps) {
  const [rootCategorySlug, setRootCategorySlug] = useState<'ev' | 'ofis' | ''>('')
  const [scopeCategorySlug, setScopeCategorySlug] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<BulkProductImportRow[]>([])
  const [previewErrors, setPreviewErrors] = useState<ImportError[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()

  const previewRows = useMemo(() => rows.slice(0, 8), [rows])
  const selectedArea = useMemo(
    () => areas.find((area) => area.slug === rootCategorySlug) ?? null,
    [areas, rootCategorySlug],
  )
  const selectedCategory = useMemo(
    () => selectedArea?.categories.find((category) => category.slug === scopeCategorySlug) ?? null,
    [selectedArea, scopeCategorySlug],
  )
  const templateHref =
    rootCategorySlug && scopeCategorySlug
      ? `/api/seller/products/bulk/template?rootCategorySlug=${encodeURIComponent(rootCategorySlug)}&scopeCategorySlug=${encodeURIComponent(scopeCategorySlug)}`
      : null

  async function handleFileChange(file: File | null) {
    setSubmitError(null)
    setResult(null)

    if (!file) {
      setFileName(null)
      setRows([])
      setPreviewErrors([])
      return
    }

    setFileName(file.name)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
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

      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
        defval: '',
      })
      const headerRow = XLSX.utils.sheet_to_json<string[]>(worksheet, {
        header: 1,
        range: 0,
        blankrows: false,
      })[0] ?? []

      const missingHeaders = getMissingBulkProductHeaders(headerRow)
      if (missingHeaders.length > 0) {
        setRows([])
        setPreviewErrors([
          {
            rowNumber: 0,
            message: `Eksik sutunlar: ${missingHeaders.join(', ')}`,
          },
        ])
        return
      }

      if (rawRows.length > MAX_BULK_IMPORT_ROWS) {
        setRows([])
        setPreviewErrors([
          {
            rowNumber: 0,
            message: `Bir seferde en fazla ${MAX_BULK_IMPORT_ROWS} satir yukleyebilirsiniz.`,
          },
        ])
        return
      }

      const parsedRows = rawRows.map((row, index) => normalizeBulkProductRow(row, index + 2))
      setRows(parsedRows.flatMap((row) => (row.data ? [row.data] : [])))
      setPreviewErrors(
        parsedRows.flatMap((row) =>
          row.errors.map((message) => ({ rowNumber: row.rowNumber, message })),
        ),
      )
    } catch (error) {
      setRows([])
      setPreviewErrors([
        {
          rowNumber: 0,
          message: error instanceof Error ? error.message : 'Dosya okunamadi.',
        },
      ])
    }
  }

  function handleDownloadTemplate() {
    if (!templateHref) return
    window.location.assign(templateHref)
  }

  function handleSubmit() {
    if (rows.length === 0 || previewErrors.length > 0) return

    startTransition(async () => {
      setSubmitError(null)
      setResult(null)

      try {
        const response = await fetch('/api/seller/products/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows,
            rootCategorySlug,
            scopeCategorySlug,
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as Partial<ImportResult> & {
          error?: string
        }

        if (!response.ok) {
          setSubmitError(payload.error ?? 'Toplu yukleme sirasinda bir hata olustu.')
          setResult(
            payload.errors
              ? { imported: 0, failed: payload.errors.length, errors: payload.errors }
              : null,
          )
          return
        }

        setResult({
          imported: payload.imported ?? 0,
          failed: payload.failed ?? 0,
          errors: payload.errors ?? [],
        })
      } catch {
        setSubmitError('Baglanti hatasi.')
      }
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Sablon Alanini Sec</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Sablon indirmek ve dosya yuklemek icin alan ve kategori secimi zorunludur. Sablonu
            indirdikten sonra ayni secim aktif kalmalidir.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="bulk-import-area" className="text-sm font-medium">
                Alan*
              </label>
              <select
                id="bulk-import-area"
                aria-label="Alan"
                value={rootCategorySlug}
                onChange={(event) => {
                  const nextValue = event.target.value as 'ev' | 'ofis' | ''
                  setRootCategorySlug(nextValue)
                  setScopeCategorySlug('')
                }}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <option value="">-- Ev veya Ofis secin --</option>
                {areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {area.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="bulk-import-category" className="text-sm font-medium">
                Kategori*
              </label>
              <select
                id="bulk-import-category"
                aria-label="Kategori"
                value={scopeCategorySlug}
                onChange={(event) => setScopeCategorySlug(event.target.value)}
                disabled={!selectedArea}
                className="w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                <option value="">
                  {selectedArea ? '-- Kategori secin --' : '-- Once alan secin --'}
                </option>
                {(selectedArea?.categories ?? []).map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleDownloadTemplate} disabled={!templateHref}>
              Sablonu indir
            </Button>
            {selectedArea && selectedCategory && (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Secilen kapsam: {selectedArea.label} / {selectedCategory.label}
              </p>
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Indirdiginiz sablonda yalnizca secilen kapsama uygun kategori listesi yer alir.
            Excel icindeki <strong>Kategori*</strong> alani bu listeden secilmelidir.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>XLSX Yukle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-dashed p-6" style={{ borderColor: 'var(--color-border)' }}>
            <label htmlFor="bulk-import-file" className="sr-only">
              XLSX dosyasi
            </label>
            <input
              id="bulk-import-file"
              type="file"
              aria-label="XLSX dosyasi"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)}
            />
            <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              {fileName ? `${fileName} secildi` : 'XLSX dosyanizi secin. Maksimum 500 satir.'}
            </p>
          </div>

          <div className="rounded-xl border p-4 text-xs space-y-1" style={{ borderColor: 'var(--color-border)' }}>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Sablon bos satirlarla gelir. Verinizi 2. satirdan itibaren doldurun.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Zorunlu basliklar: {BULK_PRODUCT_TEMPLATE_HEADERS.slice(0, 6).join(', ')}.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Gorsel URL sutunlari istege baglidir; girildiginde ilk URL ana gorsel olarak kaydedilir.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Indirim gostermek isterseniz <strong>Liste Fiyati (ustu cizili)</strong> alanina daha yuksek tutari yazin.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Yukleme sirasinda kategori seciminiz, ekranin ustunde belirlediginiz Ev/Ofis ve kategori kapsamiyla birlikte kontrol edilir.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Ayni urun adi kullanilabilir. Varyasyonlu veya varyasyonsuz urunlerde isimler ayni olabilir.
            </p>
            <p style={{ color: 'var(--color-warning, #b45309)' }}>
              Yalnizca barkod benzersiz olmalidir. Barkod baska bir saticinin mevcut urun veya varyasyon kaydinda kullaniliyorsa ilgili satir reddedilir ve barkod degistirilmelidir.
            </p>
          </div>

          {previewErrors.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium" style={{ color: 'var(--color-destructive)' }}>
                Dosyada hata var, duzeltmeden yuklenemez:
              </p>
              {previewErrors.slice(0, 5).map((error, index) => (
                <p key={`hint-${error.rowNumber}-${index}`} className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                  Satir {error.rowNumber}: {error.message}
                </p>
              ))}
              {previewErrors.length > 5 && (
                <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                  ... ve {previewErrors.length - 5} hata daha (asagida tam liste)
                </p>
              )}
            </div>
          ) : null}

          {rows.length > 0 && (!rootCategorySlug || !scopeCategorySlug) ? (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              Yuklemeden once sayfa basindaki Alan ve Kategori secimini tamamlayin.
            </p>
          ) : null}

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isPending ||
              rows.length === 0 ||
              previewErrors.length > 0 ||
              !rootCategorySlug ||
              !scopeCategorySlug
            }
          >
            {isPending ? 'Ice aktariliyor...' : `${rows.length} urunu ice aktar`}
          </Button>

          {submitError && (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {submitError}
            </p>
          )}

          {result && (
            <div
              className="rounded-xl border p-4 text-sm"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
            >
              <p>
                {result.imported} urun ice aktarildi, {result.failed} satir hata verdi.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Onizleme</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewRows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Onizleme icin bir XLSX dosyasi secin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {['Urun', 'Kategori', 'Satis Fiyati', 'Liste Fiyati', 'Stok', 'Barkod', 'Gorsel'].map((heading) => (
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
                    <tr key={`${row.name}-${index}`}>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.name}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.categorySlug}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        TL {row.price.toLocaleString('tr-TR')}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.compareAtPrice ? `TL ${row.compareAtPrice.toLocaleString('tr-TR')}` : '-'}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.stockQuantity}
                      </td>
                      <td className="border-b px-3 py-2 font-mono" style={{ borderColor: 'var(--color-border)' }}>
                        {row.barcode}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.imageUrls.length > 0 ? `${row.imageUrls.length} URL` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {previewErrors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--color-destructive)' }}>
                Dogrulama Hatalari
              </p>
              <div className="space-y-1">
                {previewErrors.slice(0, 12).map((error, index) => (
                  <p key={`${error.rowNumber}-${index}`} className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                    Satir {error.rowNumber}: {error.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {result && result.errors.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium" style={{ color: 'var(--color-destructive)' }}>
                Ice Aktarma Hatalari
              </p>
              <div className="space-y-1">
                {result.errors.slice(0, 12).map((error, index) => (
                  <p key={`${error.rowNumber}-${index}`} className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                    Satir {error.rowNumber}: {error.message}
                  </p>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
