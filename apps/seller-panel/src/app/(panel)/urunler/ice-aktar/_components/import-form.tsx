'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw } from 'lucide-react'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
} from '@hanuja/ui'
import type { ScrapedProduct } from '@hanuja/api/services/product-import/adapters/import-adapter'
import type { CommitSelection } from '@hanuja/api/services/product-import/import.service'
import {
  findSuggestedCategoryId,
  type ImportCategoryOption,
} from '@/lib/import-category-match'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutoCreateProposal {
  kind: 'auto_create_leaf'
  parentId: string
  leafName: string
}

interface EnrichedScrapedProduct extends ScrapedProduct {
  resolvedCategoryId?: string
  resolvedCategoryProposal?: AutoCreateProposal
}

interface RejectedImportItem {
  externalId: string
  name: string
  reason: string
  categoryName?: string
}

interface PreviewPayload {
  adapter: string
  items: EnrichedScrapedProduct[]
  rejected: RejectedImportItem[]
  fetchedCount: number
  totalCount: number
  isPartial: boolean
  warning?: string
}

interface ImportResult {
  importedCount: number
  selectedCount: number
  items: Array<{ id: string; name: string; barcode: string | null }>
}

type BarcodeStatus = 'idle' | 'checking' | 'ok' | 'invalid' | 'in_use'

interface ItemSelectionState {
  selected: boolean
  categoryId: string
  barcode: string
  barcodeStatus: BarcodeStatus
  barcodeNormalized: string | null
}

interface ImportFormProps {
  categories: ImportCategoryOption[]
  sellerNumber: number
}

// Sayfa ömrü boyunca önizleme state'ini koru — sayfa değişince/yenileyince kaybolmasın
const SESSION_KEY = 'hanuja_import_hipicon_v1'

interface PersistedSession {
  url: string
  preview: PreviewPayload
  selections?: Record<string, ItemSelectionState>
}

function readPersistedSession(): PersistedSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedSession
    if (
      typeof parsed?.url !== 'string' ||
      !parsed?.preview ||
      !Array.isArray(parsed.preview.items) ||
      (parsed.selections !== undefined &&
        (!parsed.selections || typeof parsed.selections !== 'object' || Array.isArray(parsed.selections)))
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writePersistedSession(value: PersistedSession) {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage dolmuş olabilir; sessizce geç
  }
}

function clearPersistedSession() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

function isBarcodeStatus(value: unknown): value is BarcodeStatus {
  return (
    value === 'idle' ||
    value === 'checking' ||
    value === 'ok' ||
    value === 'invalid' ||
    value === 'in_use'
  )
}

function normalizePersistedSelection(value: unknown): ItemSelectionState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.selected !== 'boolean') return null

  return {
    selected: candidate.selected,
    categoryId: typeof candidate.categoryId === 'string' ? candidate.categoryId : '',
    barcode: typeof candidate.barcode === 'string' ? candidate.barcode : '',
    barcodeStatus: isBarcodeStatus(candidate.barcodeStatus) ? candidate.barcodeStatus : 'idle',
    barcodeNormalized:
      typeof candidate.barcodeNormalized === 'string' ? candidate.barcodeNormalized : null,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number) {
  return `₺${value.toLocaleString('tr-TR')}`
}

function rejectionReasonLabel(reason: string): string {
  switch (reason) {
    case 'root_missing': return 'Kök kategori yok'
    case 'too_shallow': return 'Kategori çok üst seviyede'
    case 'too_divergent': return 'Hipicon çok derin kategori'
    case 'empty_path': return 'Kategori bilgisi yok'
    default: return reason
  }
}

// ---------------------------------------------------------------------------
// Barcode check hook (debounced)
// ---------------------------------------------------------------------------

function useBarcodeCheck(delay = 400) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const check = useCallback(
    (
      barcode: string,
      onResult: (status: BarcodeStatus, normalized: string | null) => void,
    ) => {
      if (timerRef.current) clearTimeout(timerRef.current)

      const trimmed = barcode.trim()
      if (!trimmed) {
        onResult('idle', null)
        return
      }

      onResult('checking', null)

      timerRef.current = setTimeout(async () => {
        try {
          const res = await fetch('/api/seller/products/barcode/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barcode: trimmed }),
          })
          const data = (await res.json()) as {
            available: boolean
            normalized: string | null
            reason?: string
          }

          if (!data.available && data.reason === 'invalid') {
            onResult('invalid', null)
          } else if (!data.available) {
            onResult('in_use', data.normalized)
          } else {
            onResult('ok', data.normalized)
          }
        } catch {
          onResult('idle', null)
        }
      }, delay)
    },
    [delay],
  )

  return check
}

// ---------------------------------------------------------------------------
// Product detail expand component
// ---------------------------------------------------------------------------

function ProductDetail({ item }: { item: EnrichedScrapedProduct }) {
  const [open, setOpen] = useState(false)
  const fields = [
    { label: 'Kısa açıklama', value: item.shortDescription },
    { label: 'Açıklama', value: item.description?.slice(0, 300) },
    { label: 'Hikaye', value: item.story?.slice(0, 300) },
    { label: 'Bakım talimatları', value: item.careInstructions?.slice(0, 300) },
    { label: 'SKU', value: item.sku },
  ].filter((f): f is { label: string; value: string } => typeof f.value === 'string' && f.value.length > 0)

  if (fields.length === 0) return null

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 text-xs"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? 'Detayları gizle' : 'Detayları göster'}
      </button>
      {open && (
        <div className="mt-2 space-y-1 rounded-md border p-2 text-xs" style={{ borderColor: 'var(--color-border)' }}>
          {fields.map((f) => (
            <div key={f.label}>
              <span className="font-medium">{f.label}: </span>
              <span style={{ color: 'var(--color-muted-fg)' }}>{f.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Barcode input cell
// ---------------------------------------------------------------------------

function BarcodeCell({
  externalId,
  hasVariants,
  state,
  isBusy,
  onBarcodeChange,
}: {
  externalId: string
  hasVariants: boolean
  state: ItemSelectionState
  isBusy: boolean
  onBarcodeChange: (externalId: string, value: string) => void
}) {
  if (hasVariants) {
    return (
      <div className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Varyantlar otomatik
      </div>
    )
  }

  const statusColor =
    state.barcodeStatus === 'ok'
      ? 'var(--color-success)'
      : state.barcodeStatus === 'in_use' || state.barcodeStatus === 'invalid'
        ? 'var(--color-destructive)'
        : 'var(--color-muted-fg)'

  const statusLabel =
    state.barcodeStatus === 'ok'
      ? 'Kullanılabilir'
      : state.barcodeStatus === 'in_use'
        ? 'Bu barkod zaten kullanımda'
        : state.barcodeStatus === 'invalid'
          ? 'Geçersiz barkod'
          : state.barcodeStatus === 'checking'
            ? 'Kontrol ediliyor…'
            : null

  return (
    <div className="space-y-1 min-w-[140px]">
      <Input
        value={state.barcode}
        onChange={(e) => onBarcodeChange(externalId, e.target.value)}
        disabled={!state.selected || isBusy}
        placeholder="13 haneli EAN"
        className="font-mono text-xs"
        id={`barcode-${externalId}`}
        autoComplete="off"
      />
      {statusLabel ? (
        <p className="text-xs" style={{ color: statusColor }}>
          {statusLabel}
          {state.barcodeStatus === 'ok' && state.barcodeNormalized
            ? ` (${state.barcodeNormalized})`
            : null}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImportForm({ categories, sellerNumber }: ImportFormProps) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [selections, setSelections] = useState<Record<string, ItemSelectionState>>({})
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [showAllRejected, setShowAllRejected] = useState(false)
  const [isPreviewPending, startPreviewTransition] = useTransition()
  const [isCommitPending, startCommitTransition] = useTransition()

  // sessionStorage'dan önizleme + url'i geri yükle (sayfa değişimi / refresh sonrası)
  const hasRestoredRef = useRef(false)
  useEffect(() => {
    if (hasRestoredRef.current) return
    hasRestoredRef.current = true
    const persisted = readPersistedSession()
    if (!persisted) return
    setUrl(persisted.url)
    applyPreview(persisted.preview, persisted.url, persisted.selections)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkBarcode = useBarcodeCheck(400)

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const selectedCount = useMemo(
    () => Object.values(selections).filter((s) => s.selected).length,
    [selections],
  )

  const missingCategoryCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      const s = selections[item.externalId]
      if (!s?.selected) return false
      if (item.resolvedCategoryProposal) return false
      return !s.categoryId.trim()
    }).length
  }, [preview, selections])

  const missingBarcodeCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      const hasVariants = (item.variants?.length ?? 0) > 0
      if (hasVariants) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      return (
        !s.barcode.trim() ||
        s.barcodeStatus === 'in_use' ||
        s.barcodeStatus === 'invalid'
      )
    }).length
  }, [preview, selections])

  useEffect(() => {
    if (!preview) return
    writePersistedSession({ url, preview, selections })
  }, [preview, selections, url])

  function applyPreview(
    nextPreview: PreviewPayload,
    sourceUrl: string,
    restoredSelections?: Record<string, ItemSelectionState>,
  ) {
    const nextSelections = Object.fromEntries(
      nextPreview.items.map((item) => {
        const resolvedId =
          item.resolvedCategoryId ??
          findSuggestedCategoryId(item.suggestedCategoryName, categories)
        const restored = normalizePersistedSelection(restoredSelections?.[item.externalId])

        return [
          item.externalId,
          restored ?? {
            selected: true,
            categoryId: resolvedId,
            barcode: item.proposedBarcode ?? '',
            barcodeStatus: 'idle' as BarcodeStatus,
            barcodeNormalized: null,
          },
        ]
      }),
    )

    setPreview(nextPreview)
    setSelections(nextSelections)
    setPreviewError(null)
    setCommitError(null)
    setResult(null)
    setShowAllRejected(false)
  }

  function updateItemSelection(
    externalId: string,
    updater: (current: ItemSelectionState) => ItemSelectionState,
  ) {
    setSelections((current) => {
      const existing = current[externalId] ?? {
        selected: false,
        categoryId: '',
        barcode: '',
        barcodeStatus: 'idle' as BarcodeStatus,
        barcodeNormalized: null,
      }
      return { ...current, [externalId]: updater(existing) }
    })
  }

  function setAllSelected(selected: boolean) {
    setSelections((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, s]) => [id, { ...s, selected }]),
      ),
    )
  }

  const handleBarcodeChange = useCallback(
    (externalId: string, value: string) => {
      updateItemSelection(externalId, (current) => ({
        ...current,
        barcode: value,
        barcodeStatus: 'idle',
        barcodeNormalized: null,
      }))

      checkBarcode(value, (status, normalized) => {
        setSelections((prev) => {
          const existing = prev[externalId]
          if (!existing) return prev
          return {
            ...prev,
            [externalId]: {
              ...existing,
              barcodeStatus: status,
              barcodeNormalized: normalized,
            },
          }
        })
      })
    },
    [checkBarcode],
  )

  // Trigger barcode checks for current draft barcodes after preview loads.
  useEffect(() => {
    if (!preview) return
    for (const item of preview.items) {
      const hasVariants = (item.variants?.length ?? 0) > 0
      if (hasVariants) continue
      const current = selections[item.externalId]
      if (!current?.barcode) continue
      checkBarcode(current.barcode, (status, normalized) => {
        setSelections((prev) => {
          const existing = prev[item.externalId]
          if (!existing) return prev
          return {
            ...prev,
            [item.externalId]: {
              ...existing,
              barcodeStatus: status,
              barcodeNormalized: normalized,
            },
          }
        })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.adapter])

  function buildCommitSelections(): CommitSelection[] {
    if (!preview) return []

    const commitSelections: CommitSelection[] = []

    for (const item of preview.items) {
      const s = selections[item.externalId]
      if (!s?.selected) continue

      const proposal = item.resolvedCategoryProposal

      if (proposal) {
        commitSelections.push({
          externalId: item.externalId,
          autoCreateUnder: {
            parentId: proposal.parentId,
            leafName: proposal.leafName,
          },
          barcode: s.barcode.trim() || null,
        })
        continue
      }

      commitSelections.push({
        externalId: item.externalId,
        categoryId: s.categoryId.trim(),
        barcode: s.barcode.trim() || null,
      })
    }

    return commitSelections
  }

  function handlePreview() {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setPreviewError('Hipicon mağaza URLsi girin.')
      return
    }

    startPreviewTransition(async () => {
      setPreviewError(null)
      setCommitError(null)
      setResult(null)

      try {
        const response = await fetch('/api/seller/products/import/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmedUrl }),
        })

        const payload = (await response.json().catch(() => ({}))) as PreviewPayload & {
          error?: string
        }

        if (!response.ok) {
          setPreviewError(payload.error ?? 'Hipicon önizlemesi alınmadı.')
          return
        }

        applyPreview(payload, trimmedUrl)
      } catch {
        setPreviewError('Bağlantı hatası.')
      }
    })
  }

  function handleClearPreview() {
    setPreview(null)
    setSelections({})
    setPreviewError(null)
    setCommitError(null)
    setResult(null)
    setShowAllRejected(false)
    clearPersistedSession()
  }

  function handleCommit() {
    if (!preview) return

    const commitSelections = buildCommitSelections()
    if (commitSelections.length === 0) {
      setCommitError('İçe aktarılacak en az bir ürün seçin.')
      return
    }

    if (commitSelections.some((s) => !('autoCreateUnder' in s) && !s.categoryId)) {
      setCommitError('Seçili ürünlerin tamamında kategori zorunludur.')
      return
    }

    startCommitTransition(async () => {
      setCommitError(null)
      setResult(null)

      try {
        const response = await fetch('/api/seller/products/import/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adapter: preview.adapter,
            externalUrl: url.trim(),
            items: preview.items,
            selections: commitSelections,
          }),
        })

        const payload = (await response.json().catch(() => ({}))) as ImportResult & {
          error?: string
        }

        if (!response.ok) {
          setCommitError(payload.error ?? 'İçe aktarma sırasında bir hata oluştu.')
          return
        }

        setResult(payload)
        // Tek kullanımlık izin tüketildi — sayfa yenilense bile gate ekranı dönecek
        clearPersistedSession()
      } catch {
        setCommitError('Bağlantı hatası.')
      }
    })
  }

  const isBusy = isPreviewPending || isCommitPending

  const commitDisabled =
    isBusy ||
    selectedCount === 0 ||
    missingCategoryCount > 0 ||
    missingBarcodeCount > 0

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium">Tek kullanımlık Hipicon import izni aktif.</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Başarılı içe aktarma sonrası izin otomatik kapanır. Önizleme taslağınız bu
            tarayıcı oturumunda sayfa değiştirseniz bile korunur.
          </p>
        </CardContent>
      </Card>

      {/* URL input */}
      <Card>
        <CardHeader>
          <CardTitle>Hipicon Mağaza URL&apos;si</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <label htmlFor="hipicon-store-url" className="text-sm font-medium">
                Mağaza URL&apos;si
              </label>
              <Input
                id="hipicon-store-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.hipicon.com/magaza-adi"
                autoComplete="off"
                disabled={isBusy}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={handlePreview} disabled={isBusy}>
                {isPreviewPending ? 'Ürünler çekiliyor...' : 'Önizleme getir'}
              </Button>
            </div>
          </div>

          {previewError ? (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {previewError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Preview & selection */}
      <Card>
        <CardHeader>
          <CardTitle>Önizleme ve Seçim</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!preview ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Önizleme için önce bir Hipicon mağaza URL&apos;si girin.
            </p>
          ) : (
            <>
              {/* Rejected items summary */}
              {preview.rejected?.length > 0 ? (
                <div
                  className="rounded-xl border p-4 text-sm space-y-2"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
                >
                  <p>
                    <span className="font-medium">{preview.items.length}</span> ürün listelendi.{' '}
                    <span className="font-medium">{preview.rejected.length}</span> ürün bizdeki
                    kategorilere uymadığı için atlandı.
                  </p>
                  <ul className="space-y-0.5 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {(showAllRejected
                      ? preview.rejected
                      : preview.rejected.slice(0, 5)
                    ).map((r) => (
                      <li key={r.externalId}>
                        {r.name}
                        {r.categoryName ? ` (${r.categoryName})` : ''} —{' '}
                        {rejectionReasonLabel(r.reason)}
                      </li>
                    ))}
                  </ul>
                  {preview.rejected.length > 5 ? (
                    <button
                      type="button"
                      className="text-xs underline"
                      style={{ color: 'var(--color-accent)' }}
                      onClick={() => setShowAllRejected((v) => !v)}
                    >
                      {showAllRejected
                        ? 'Daha az göster'
                        : `Tümünü göster (${preview.rejected.length})`}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* Stats */}
              <div className="grid gap-3 md:grid-cols-4">
                {[
                  { label: 'Kaynak', value: preview.adapter },
                  { label: 'Listelenen ürün', value: preview.items.length },
                  { label: 'Seçilen ürün', value: selectedCount },
                  { label: 'Kategori bekleyen', value: missingCategoryCount },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-xl border p-4"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {stat.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{stat.value}</p>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => setAllSelected(true)}>
                  Hepsini seç
                </Button>
                <Button type="button" variant="outline" onClick={() => setAllSelected(false)}>
                  Hepsini kaldır
                </Button>
                <Button type="button" onClick={handleCommit} disabled={commitDisabled}>
                  {isCommitPending ? 'İçe aktarılıyor...' : 'Seçileni içe aktar'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handlePreview}
                  disabled={isBusy}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Önizlemeyi yenile
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearPreview}
                  disabled={isBusy}
                >
                  Önizlemeyi temizle
                </Button>
              </div>

              {/* Info bar */}
              <div
                className="space-y-1 rounded-xl border p-4 text-sm"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <p style={{ color: 'var(--color-muted-fg)' }}>
                  Hipicon toplamda {preview.totalCount} ürün bildiriyor, bu oturumda{' '}
                  {preview.fetchedCount} ürün çekildi.
                </p>
                {preview.isPartial ? (
                  <p style={{ color: 'var(--color-warning, #b45309)' }}>
                    Önizleme kısmi olabilir. Commit sadece şu an listelenen ürünlerle çalışır.
                  </p>
                ) : null}
                {preview.warning ? (
                  <p style={{ color: 'var(--color-warning, #b45309)' }}>{preview.warning}</p>
                ) : null}
                {missingCategoryCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    Seçili ürünlerin tamamında kategori seçimi zorunludur.
                  </p>
                ) : null}
                {missingBarcodeCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    {missingBarcodeCount} seçili üründe barkod eksik veya geçersiz.
                  </p>
                ) : null}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      {[
                        'Seç',
                        'Ürün',
                        'Barkod',
                        'Stok',
                        'Hipicon kategorisi',
                        'Hedef kategori',
                        'Fiyat',
                        'Varyasyon',
                        'Kaynak',
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="border-b px-3 py-2 text-left"
                          style={{
                            borderColor: 'var(--color-border)',
                            color: 'var(--color-muted-fg)',
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => {
                      const s = selections[item.externalId] ?? {
                        selected: false,
                        categoryId: '',
                        barcode: '',
                        barcodeStatus: 'idle' as BarcodeStatus,
                        barcodeNormalized: null,
                      }
                      const hasVariants = (item.variants?.length ?? 0) > 0
                      const proposal = item.resolvedCategoryProposal

                      const categoryDisplay = proposal
                        ? null // handled separately
                        : s.categoryId
                          ? (categoryNameById.get(s.categoryId) ?? s.categoryId)
                          : ''

                      return (
                        <tr key={item.externalId}>
                          {/* Checkbox */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <Checkbox
                              checked={s.selected}
                              onCheckedChange={(checked) =>
                                updateItemSelection(item.externalId, (cur) => ({
                                  ...cur,
                                  selected: checked === true,
                                }))
                              }
                              aria-label={`${item.name} seçimi`}
                            />
                          </td>

                          {/* Product */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="flex gap-2">
                              {item.imageUrls[0] ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={item.imageUrls[0]}
                                  alt={item.name}
                                  width={48}
                                  height={48}
                                  loading="lazy"
                                  className="h-12 w-12 flex-shrink-0 rounded object-cover"
                                  style={{ border: '1px solid var(--color-border)' }}
                                />
                              ) : (
                                <div
                                  className="h-12 w-12 flex-shrink-0 rounded"
                                  style={{ backgroundColor: 'var(--color-muted)' }}
                                />
                              )}
                              <div className="min-w-0 space-y-0.5">
                                <p className="font-medium leading-tight">{item.name}</p>
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  {item.imageUrls.length} görsel
                                </p>
                                <ProductDetail item={item} />
                              </div>
                            </div>
                          </td>

                          {/* Barcode */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <BarcodeCell
                              externalId={item.externalId}
                              hasVariants={hasVariants}
                              state={s}
                              isBusy={isBusy}
                              onBarcodeChange={handleBarcodeChange}
                            />
                          </td>

                          {/* Stock */}
                          <td
                            className="border-b px-3 py-3 align-top text-center"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                          >
                            {item.stockQuantity !== undefined ? item.stockQuantity : '—'}
                          </td>

                          {/* Hipicon category */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="space-y-1">
                              <p>{item.suggestedCategoryName?.trim() || '-'}</p>
                              {proposal ? (
                                <p className="text-xs" style={{ color: 'var(--color-success)' }}>
                                  Öneri eşleşti (yaprak eklenecek)
                                </p>
                              ) : categoryDisplay ? (
                                <p className="text-xs" style={{ color: 'var(--color-success)' }}>
                                  Öneri eşleşti
                                </p>
                              ) : (
                                <p className="text-xs" style={{ color: 'var(--color-warning)' }}>
                                  Manuel kategori seçin
                                </p>
                              )}
                            </div>
                          </td>

                          {/* Target category */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            {proposal ? (
                              <div className="space-y-1">
                                <p
                                  className="rounded-md border px-2 py-1.5 text-xs"
                                  style={{
                                    borderColor: 'var(--color-border)',
                                    backgroundColor: 'var(--color-muted)',
                                    color: 'var(--color-muted-fg)',
                                  }}
                                >
                                  🆕 Yeni alt kategori açılacak: {proposal.leafName}
                                </p>
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  {categoryNameById.get(proposal.parentId) ?? proposal.parentId} altına
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <label htmlFor={`category-${item.externalId}`} className="sr-only">
                                  Hedef kategori
                                </label>
                                <select
                                  id={`category-${item.externalId}`}
                                  value={s.categoryId}
                                  onChange={(e) =>
                                    updateItemSelection(item.externalId, (cur) => ({
                                      ...cur,
                                      categoryId: e.target.value,
                                    }))
                                  }
                                  disabled={!s.selected || isBusy}
                                  className="w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                  style={{
                                    borderColor: 'var(--color-border)',
                                    backgroundColor: 'var(--color-surface)',
                                  }}
                                >
                                  <option value="">-- Kategori seçin --</option>
                                  {categories.map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                      {cat.name}
                                    </option>
                                  ))}
                                </select>
                                {categoryDisplay ? (
                                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                    {categoryDisplay}
                                  </p>
                                ) : null}
                              </div>
                            )}
                          </td>

                          {/* Price */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="space-y-1">
                              <p>{formatMoney(item.price)}</p>
                              {item.compareAtPrice ? (
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  Liste: {formatMoney(item.compareAtPrice)}
                                </p>
                              ) : null}
                            </div>
                          </td>

                          {/* Variants */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            {item.variants?.length ? `${item.variants.length} varyasyon` : '-'}
                          </td>

                          {/* Source link */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <a
                              href={item.externalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm hover:underline"
                              style={{ color: 'var(--color-accent)' }}
                            >
                              Kaynağı aç
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {commitError ? (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {commitError}
            </p>
          ) : null}

          {result ? (
            <div
              className="space-y-2 rounded-xl border p-4 text-sm"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-muted)',
              }}
            >
              <p>
                {result.importedCount} / {result.selectedCount} seçili ürün içe aktarıldı.
              </p>
              {result.items.length > 0 ? (
                <div className="space-y-1">
                  {result.items.slice(0, 6).map((item) => (
                    <p key={item.id} style={{ color: 'var(--color-muted-fg)' }}>
                      {item.name}
                    </p>
                  ))}
                  {result.items.length > 6 ? (
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      ... ve {result.items.length - 6} ürün daha
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
