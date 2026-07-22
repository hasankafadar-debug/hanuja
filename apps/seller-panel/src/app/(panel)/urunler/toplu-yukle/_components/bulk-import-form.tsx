'use client'

import { useMemo, useState, useTransition } from 'react'
import * as XLSX from 'xlsx'
import { Button, Card, CardContent, CardHeader, CardTitle } from '@hanuja/ui'
import {
  MAX_BULK_IMPORT_ROWS,
  getMissingBulkProductHeaders,
  normalizeBulkProductRow,
  serializeBulkProductImportRowsForApi,
  type BulkProductImportRow,
} from '@/lib/bulk-product-import'
import { buildChildrenMap } from '../../_lib/category-tree'

interface TemplateCategory {
  slug: string
  label: string
}

/** Scope tree node; `id`/`parentId` are category slugs (see buildBulkScopeNodes). */
interface TemplateScopeNode {
  id: string
  name: string
  parentId: string | null
}

interface TemplateArea {
  slug: 'ev' | 'ofis'
  label: string
  categories: TemplateCategory[]
  scopeNodes: TemplateScopeNode[]
}

interface ImportError {
  rowNumber: number
  message: string
  field?: string
  code?: string
}

interface ImportResult {
  imported: number
  failed: number
  errors: ImportError[]
}

interface BulkImportFormProps {
  areas: TemplateArea[]
}

type PreviewRow = BulkProductImportRow & { rowNumber: number }

const REQUIRED_BULK_PRODUCT_HEADERS = [
  'Model Kodu*',
  'Urun Adi*',
  'Kategori*',
  'Urun Rengi*',
  'Materyal*',
  'Fiyat*',
  'Sevk Suresi (is gunu)*',
  'Stok*',
  'Barkod (13 hane)*',
]

export function BulkImportForm({ areas }: BulkImportFormProps) {
  const [rootCategorySlug, setRootCategorySlug] = useState<'ev' | 'ofis' | ''>('')
  const [scopeCategorySlug, setScopeCategorySlug] = useState('')
  // Chosen scope slug per cascade level; the last entry is the active scope.
  const [scopePath, setScopePath] = useState<string[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [previewErrors, setPreviewErrors] = useState<ImportError[]>([])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isValidating, setIsValidating] = useState(false)

  const previewRows = useMemo(() => rows.slice(0, 8), [rows])
  const selectedArea = useMemo(
    () => areas.find((area) => area.slug === rootCategorySlug) ?? null,
    [areas, rootCategorySlug],
  )
  const scopeNodes = useMemo(() => selectedArea?.scopeNodes ?? [], [selectedArea])
  const scopeChildrenMap = useMemo(() => buildChildrenMap(scopeNodes), [scopeNodes])
  const scopeNameById = useMemo(
    () => new Map(scopeNodes.map((node) => [node.id, node.name])),
    [scopeNodes],
  )

  // One select per level: the levels already chosen, plus the next open one.
  const scopeLevels = useMemo(() => {
    const levels: TemplateScopeNode[][] = []
    let parentId: string | null = null

    for (const selectedId of scopePath) {
      const options = scopeChildrenMap.get(parentId) ?? []
      if (options.length === 0) break
      levels.push(options)
      parentId = selectedId
    }

    const nextOptions = scopeChildrenMap.get(parentId) ?? []
    if (nextOptions.length > 0) levels.push(nextOptions)

    return levels
  }, [scopeChildrenMap, scopePath])

  const scopeBreadcrumb = scopePath
    .map((slug) => scopeNameById.get(slug))
    .filter((name): name is string => Boolean(name))
    .join(' / ')

  function handleScopeLevelChange(levelIndex: number, categorySlug: string) {
    if (!categorySlug) {
      const truncated = scopePath.slice(0, levelIndex)
      setScopePath(truncated)
      // Any level is a valid scope, so falling back one level keeps a usable selection.
      setScopeCategorySlug(truncated[truncated.length - 1] ?? '')
      return
    }

    const nextPath = [...scopePath.slice(0, levelIndex), categorySlug]
    setScopePath(nextPath)
    setScopeCategorySlug(categorySlug)
  }
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
        setPreviewErrors([{ rowNumber: 0, field: 'file', code: 'worksheet_missing', message: 'Calisma sayfasi bulunamadi.' }])
        return
      }

      const worksheet = workbook.Sheets[firstSheetName]
      if (!worksheet) {
        setRows([])
        setPreviewErrors([{ rowNumber: 0, field: 'file', code: 'worksheet_missing', message: 'Calisma sayfasi bulunamadi.' }])
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
            field: 'headers',
            code: 'missing_headers',
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
            field: 'rows',
            code: 'too_many_rows',
            message: `Bir seferde en fazla ${MAX_BULK_IMPORT_ROWS} satir yukleyebilirsiniz.`,
          },
        ])
        return
      }

      const parsedRows = rawRows.map((row, index) => normalizeBulkProductRow(row, index + 2))
      const localErrors =
        parsedRows.flatMap((row) =>
          row.errors.map((message) => ({ rowNumber: row.rowNumber, field: 'row', code: 'invalid_row', message })),
        )
      const validRows = parsedRows.flatMap((row) => (row.data ? [{ ...row.data, rowNumber: row.rowNumber }] : []))
      setRows(validRows)
      setPreviewErrors(localErrors)

      if (localErrors.length > 0 || validRows.length === 0 || !rootCategorySlug || !scopeCategorySlug) return

      setIsValidating(true)
      try {
        const apiRows = serializeBulkProductImportRowsForApi(validRows).map((row, index) => ({
          ...row,
          rowNumber: validRows[index]?.rowNumber,
        }))
        const response = await fetch('/api/seller/products/bulk/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: apiRows, rootCategorySlug, scopeCategorySlug }),
        })
        const payload = (await response.json().catch(() => ({}))) as { errors?: ImportError[]; error?: string }
        if (!response.ok) {
          setPreviewErrors(payload.errors?.length ? payload.errors : [{ rowNumber: 0, field: 'file', code: 'validation_failed', message: payload.error ?? 'Dosya dogrulanamadi.' }])
          return
        }
        setPreviewErrors(payload.errors ?? [])
      } catch {
        setPreviewErrors([{ rowNumber: 0, field: 'file', code: 'validation_unavailable', message: 'Dosya dogrulama servisine baglanilamadi.' }])
      } finally {
        setIsValidating(false)
      }
    } catch (error) {
      setRows([])
      setPreviewErrors([
        {
          rowNumber: 0,
          field: 'file',
          code: 'file_unreadable',
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
        const apiRows = serializeBulkProductImportRowsForApi(rows).map((row, index) => ({
          ...row,
          rowNumber: rows[index]?.rowNumber,
        }))
        const response = await fetch('/api/seller/products/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rows: apiRows,
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
                  setScopePath([])
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
              {!selectedArea ? (
                <select
                  id="bulk-import-category"
                  aria-label="Kategori"
                  value=""
                  disabled
                  className="w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                  }}
                >
                  <option value="">-- Once alan secin --</option>
                </select>
              ) : (
                <div className="space-y-2">
                  {scopeLevels.map((options, levelIndex) => (
                    <select
                      key={levelIndex}
                      id={levelIndex === 0 ? 'bulk-import-category' : `bulk-import-category-${levelIndex}`}
                      aria-label={levelIndex === 0 ? 'Kategori' : 'Alt kategori'}
                      value={scopePath[levelIndex] ?? ''}
                      onChange={(event) => handleScopeLevelChange(levelIndex, event.target.value)}
                      className="w-full rounded-md border px-3 py-2 text-sm"
                      style={{
                        borderColor: 'var(--color-border)',
                        backgroundColor: 'var(--color-surface)',
                      }}
                    >
                      <option value="">
                        {levelIndex === 0 ? '-- Kategori secin --' : '-- Alt kategori (istege bagli) --'}
                      </option>
                      {options.map((node) => (
                        <option key={node.id} value={node.id}>
                          {node.name}
                        </option>
                      ))}
                    </select>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handleDownloadTemplate} disabled={!templateHref}>
              Sablonu indir
            </Button>
            {selectedArea && scopeBreadcrumb && (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Secilen kapsam: {selectedArea.label} / {scopeBreadcrumb}
              </p>
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Indirdiginiz sablonda yalnizca secilen kapsama uygun kategori listesi yer alir.
            Excel icindeki <strong>Kategori*</strong> alani bu listeden secilmelidir. Ust seviyede
            durursaniz sablon o dalin tum alt kategorilerini icerir; boylece tek dosyada birden fazla
            kategoriye urun yukleyebilirsiniz.
          </p>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            <strong>Uyari:</strong> Excel icindeki <strong>Urun Rengi*</strong> ve <strong>Materyal*</strong>{' '}
            secimleri kategoriye baglidir. Bu listeler ancak ayni satirda once <strong>Kategori*</strong>{' '}
            secildikten sonra gorunur.
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
              Zorunlu basliklar: {REQUIRED_BULK_PRODUCT_HEADERS.join(', ')}.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Gorsel URL sutunlari istege baglidir; girildiginde ilk URL ana gorsel olarak kaydedilir.
            </p>
            <p style={{ color: 'var(--color-muted-fg)' }}>
              Urun gorsellerinde 1:1 tavsiye edilir. Farkli oranlar kabul edilir; kare alanlarda uygun sekilde kirpilarak gosterilir.
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
              Renk veya materyal kardeslerini baglamak icin ayni <strong>Model Kodu</strong> kullanin. SKU yalnizca kendi sisteminizdeki istege bagli urun kodunuzdur.
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
              isValidating ||
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
          {isValidating ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>Dosya ve barkodlar kontrol ediliyor...</p>
          ) : previewRows.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Onizleme icin bir XLSX dosyasi secin.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    {['Urun', 'Kategori', 'Renk', 'Materyal', 'Satis Fiyati', 'Liste Fiyati', 'Stok', 'Barkod', 'Gorsel'].map((heading) => (
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
                    <tr key={`${row.name}-${index}`} style={previewErrors.some((error) => error.rowNumber === row.rowNumber) ? { backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)' } : undefined}>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.name}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.categorySlug}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.productColor}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.productMaterial}
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.price.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                      </td>
                      <td className="border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}>
                        {row.compareAtPrice ? `${row.compareAtPrice.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL` : '-'}
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
