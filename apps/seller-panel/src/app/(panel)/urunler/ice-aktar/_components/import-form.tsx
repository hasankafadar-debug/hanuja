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
import { CategorySupportHint } from '../../_components/category-support-hint'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutoCreateProposal {
  kind: 'auto_create_leaf'
  parentId: string
  leafName: string
}

interface AttributeOption {
  id: string
  slug: string
  label: string
  hexColor?: string | null
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
  colorOptionId: string
  materialOptionId: string
  modelCode: string
  barcode: string
  barcodeStatus: BarcodeStatus
  barcodeNormalized: string | null
  fulfillmentDays: number
  stockQuantity: number
}

interface ImportFormProps {
  categories: ImportCategoryOption[]
}

// Sayfa ömrü boyunca önizleme state'ini koru — sayfa değişince/yenileyince kaybolmasın
const SESSION_KEY = 'hanuja_import_hipicon_v1'

interface PersistedSession {
  url: string
  preview: PreviewPayload
  selections?: Record<string, ItemSelectionState>
  importedByExternalId?: Record<string, { id: string; name: string; barcode: string | null }>
  result?: ImportResult | null
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
        (!parsed.selections || typeof parsed.selections !== 'object' || Array.isArray(parsed.selections))) ||
      (parsed.importedByExternalId !== undefined &&
        (!parsed.importedByExternalId ||
          typeof parsed.importedByExternalId !== 'object' ||
          Array.isArray(parsed.importedByExternalId)))
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
    colorOptionId: typeof candidate.colorOptionId === 'string' ? candidate.colorOptionId : '',
    materialOptionId: typeof candidate.materialOptionId === 'string' ? candidate.materialOptionId : '',
    modelCode: typeof candidate.modelCode === 'string' ? candidate.modelCode : '',
    barcode: typeof candidate.barcode === 'string' ? candidate.barcode : '',
    barcodeStatus: isBarcodeStatus(candidate.barcodeStatus) ? candidate.barcodeStatus : 'idle',
    barcodeNormalized:
      typeof candidate.barcodeNormalized === 'string' ? candidate.barcodeNormalized : null,
    fulfillmentDays:
      typeof candidate.fulfillmentDays === 'number' && Number.isInteger(candidate.fulfillmentDays) && candidate.fulfillmentDays >= 1
        ? candidate.fulfillmentDays
        : 0, // 0 = girilmedi; satıcı açıkça girmeden commit engellenir
    stockQuantity:
      typeof candidate.stockQuantity === 'number' && Number.isInteger(candidate.stockQuantity) && candidate.stockQuantity >= 0
        ? candidate.stockQuantity
        : 0,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMoney(value: number) {
  const formatted = value.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatted} TL`
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

function createEmptySelectionState(): ItemSelectionState {
  return {
    selected: false,
    categoryId: '',
    colorOptionId: '',
    materialOptionId: '',
    modelCode: '',
    barcode: '',
    barcodeStatus: 'idle',
    barcodeNormalized: null,
    fulfillmentDays: 0, // satıcı ürün bazlı sevk süresini kendisi girmek zorunda
    stockQuantity: 0,
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
        placeholder="Boş = otomatik üretilir"
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

export function ImportForm({ categories }: ImportFormProps) {
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PreviewPayload | null>(null)
  const [selections, setSelections] = useState<Record<string, ItemSelectionState>>({})
  const [attributeOptionsByCategoryId, setAttributeOptionsByCategoryId] = useState<
    Record<string, { colorOptions: AttributeOption[]; materialOptions: AttributeOption[] }>
  >({})
  const [attributeLoadingByCategoryId, setAttributeLoadingByCategoryId] = useState<Record<string, boolean>>({})
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importedByExternalId, setImportedByExternalId] = useState<Record<string, { id: string; name: string; barcode: string | null }>>({})
  const [showAllRejected, setShowAllRejected] = useState(false)
  const [bulkStockValue, setBulkStockValue] = useState('0')
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
    setImportedByExternalId(persisted.importedByExternalId ?? {})
    setResult(persisted.result ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkBarcode = useBarcodeCheck(400)

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )
  const categorySlugById = useMemo(
    () => new Map(categories.map((c) => [c.id, c.slug])),
    [categories],
  )

  const selectedCount = useMemo(
    () =>
      Object.entries(selections).filter(
        ([externalId, s]) => s.selected && !importedByExternalId[externalId],
      ).length,
    [importedByExternalId, selections],
  )
  const importedCount = Object.keys(importedByExternalId).length

  const missingCategoryCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      if (item.resolvedCategoryProposal) return false
      return !s.categoryId.trim()
    }).length
  }, [importedByExternalId, preview, selections])

  // Barcode is optional: only an entered barcode that is invalid or already in
  // use blocks commit. Blank barcodes are auto-generated ("8"-prefixed) on save.
  const missingBarcodeCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const hasVariants = (item.variants?.length ?? 0) > 0
      if (hasVariants) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      if (!s.barcode.trim()) return false
      return s.barcodeStatus === 'in_use' || s.barcodeStatus === 'invalid'
    }).length
  }, [importedByExternalId, preview, selections])

  const missingModelCodeCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const selection = selections[item.externalId]
      return selection?.selected === true && !selection.modelCode.trim()
    }).length
  }, [importedByExternalId, preview, selections])

  const missingColorCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      return !s.colorOptionId.trim()
    }).length
  }, [importedByExternalId, preview, selections])

  const missingMaterialCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      return !s.materialOptionId.trim()
    }).length
  }, [importedByExternalId, preview, selections])

  const missingFulfillmentCount = useMemo(() => {
    if (!preview) return 0
    return preview.items.filter((item) => {
      if (importedByExternalId[item.externalId]) return false
      const s = selections[item.externalId]
      if (!s?.selected) return false
      return !Number.isInteger(s.fulfillmentDays) || s.fulfillmentDays < 1
    }).length
  }, [importedByExternalId, preview, selections])

  useEffect(() => {
    if (!preview) return
    writePersistedSession({ url, preview, selections, importedByExternalId, result })
  }, [importedByExternalId, preview, result, selections, url])

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
            colorOptionId: item.detectedColorOptionId ?? '',
            materialOptionId: item.detectedMaterialOptionId ?? '',
            modelCode: item.sku?.trim() ?? '',
            barcode: item.proposedBarcode ?? '',
            barcodeStatus: 'idle' as BarcodeStatus,
            barcodeNormalized: null,
            fulfillmentDays: 0, // satıcı ürün bazlı sevk süresini kendisi girmek zorunda
            stockQuantity: Math.max(0, Math.trunc(item.stockQuantity ?? 0)),
          },
        ]
      }),
    )

    setPreview(nextPreview)
    setSelections(nextSelections)
    setPreviewError(null)
    setCommitError(null)
    setResult(null)
    setImportedByExternalId({})
    setAttributeOptionsByCategoryId({})
    setAttributeLoadingByCategoryId({})
    setShowAllRejected(false)
  }

  function updateItemSelection(
    externalId: string,
    updater: (current: ItemSelectionState) => ItemSelectionState,
  ) {
    setSelections((current) => {
      const existing = current[externalId] ?? createEmptySelectionState()
      return { ...current, [externalId]: updater(existing) }
    })
  }

  function setAllSelected(selected: boolean) {
    setSelections((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, s]) => [
          id,
          { ...s, selected: importedByExternalId[id] ? false : selected },
        ]),
      ),
    )
  }

  function setStockForAll(value: number) {
    const normalized = Math.max(0, Math.trunc(value))
    setSelections((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, selection]) => [
          id,
          { ...selection, stockQuantity: importedByExternalId[id] ? selection.stockQuantity : normalized },
        ]),
      ),
    )
  }

  const ensureAttributeOptionsLoaded = useCallback(
    async (categoryId: string) => {
      const categorySlug = categorySlugById.get(categoryId)
      if (!categoryId || !categorySlug || attributeOptionsByCategoryId[categoryId] || attributeLoadingByCategoryId[categoryId]) {
        return
      }

      setAttributeLoadingByCategoryId((current) => ({ ...current, [categoryId]: true }))

      try {
        const response = await fetch(`/api/categories/${encodeURIComponent(categorySlug)}/attributes`)
        const payload = (await response.json().catch(() => ({}))) as {
          colorOptions?: AttributeOption[]
          materialOptions?: AttributeOption[]
        }

        if (!response.ok) return

        setAttributeOptionsByCategoryId((current) => ({
          ...current,
          [categoryId]: {
            colorOptions: payload.colorOptions ?? [],
            materialOptions: payload.materialOptions ?? [],
          },
        }))
      } finally {
        setAttributeLoadingByCategoryId((current) => {
          const next = { ...current }
          delete next[categoryId]
          return next
        })
      }
    },
    [attributeLoadingByCategoryId, attributeOptionsByCategoryId, categorySlugById],
  )

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

  useEffect(() => {
    if (!preview) return
    const categoryIds = new Set<string>()

    for (const item of preview.items) {
      const selection = selections[item.externalId]
      if (selection?.categoryId) {
        categoryIds.add(selection.categoryId)
        continue
      }

      if (item.resolvedCategoryProposal?.parentId) {
        categoryIds.add(item.resolvedCategoryProposal.parentId)
      }
    }

    for (const categoryId of categoryIds) {
      void ensureAttributeOptionsLoaded(categoryId)
    }
  }, [ensureAttributeOptionsLoaded, preview, selections])

  function buildCommitSelections(): CommitSelection[] {
    if (!preview) return []

    const commitSelections: CommitSelection[] = []

    for (const item of preview.items) {
      if (importedByExternalId[item.externalId]) continue
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
          colorOptionId: s.colorOptionId.trim(),
          materialOptionId: s.materialOptionId.trim(),
          modelCode: s.modelCode.trim(),
          barcode: s.barcode.trim() || null,
          fulfillmentDays: s.fulfillmentDays,
          stockQuantity: s.stockQuantity,
        })
        continue
      }

      commitSelections.push({
        externalId: item.externalId,
        categoryId: s.categoryId.trim(),
        colorOptionId: s.colorOptionId.trim(),
        materialOptionId: s.materialOptionId.trim(),
        modelCode: s.modelCode.trim(),
        barcode: s.barcode.trim() || null,
        fulfillmentDays: s.fulfillmentDays,
        stockQuantity: s.stockQuantity,
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
      setImportedByExternalId({})

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
    setAttributeOptionsByCategoryId({})
    setAttributeLoadingByCategoryId({})
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
    if (commitSelections.some((s) => !s.colorOptionId || !s.materialOptionId)) {
      setCommitError('Seçili ürünlerin tamamında renk ve materyal zorunludur.')
      return
    }
    if (commitSelections.some((s) => !s.modelCode)) {
      setCommitError('Seçili ürünlerin tamamında Model Kodu zorunludur.')
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
        const importedEntries = Object.fromEntries(
          commitSelections.map((selection, index) => [
            selection.externalId,
            payload.items[index] ?? {
              id: selection.externalId,
              name: selection.externalId,
              barcode: null,
            },
          ]),
        )
        setImportedByExternalId((current) => ({ ...current, ...importedEntries }))
        setSelections((current) => {
          const next = { ...current }
          for (const selection of commitSelections) {
            const existing = next[selection.externalId]
            if (existing) {
              next[selection.externalId] = { ...existing, selected: false }
            }
          }
          return next
        })
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
    missingModelCodeCount > 0 ||
    missingBarcodeCount > 0 ||
    missingFulfillmentCount > 0 ||
    missingColorCount > 0 ||
    missingMaterialCount > 0

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium">Hipicon import izni aktif.</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Önizleme taslağınız bu tarayıcı oturumunda sayfa değiştirseniz bile korunur.
            Eklenen ürünler satır bazında işaretlenir; kalan ürünleri daha sonra içe aktarabilirsiniz.
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
              <div className="grid gap-3 md:grid-cols-5">
                {[
                  { label: 'Kaynak', value: preview.adapter },
                  { label: 'Listelenen ürün', value: preview.items.length },
                  { label: 'Eklenen ürün', value: importedCount },
                  { label: 'Seçilen ürün', value: selectedCount },
                  { label: 'Kategori bekleyen', value: missingCategoryCount },
                  { label: 'Model Kodu bekleyen', value: missingModelCodeCount },
                  { label: 'Sevk süresi bekleyen', value: missingFulfillmentCount },
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
                <Button type="button" variant="outline" onClick={() => setStockForAll(0)}>
                  Tumunu 0 yap
                </Button>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={bulkStockValue}
                    onChange={(event) => setBulkStockValue(event.target.value)}
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStockForAll(Number.parseInt(bulkStockValue || '0', 10))}
                  >
                    Tumune uygula
                  </Button>
                </div>
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
                    {missingBarcodeCount} seçili üründe girilen barkod geçersiz veya kullanımda. Boş bırakabilir ya da düzeltebilirsiniz.
                  </p>
                ) : null}
                {missingModelCodeCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    {missingModelCodeCount} seçili üründe Model Kodu zorunludur.
                  </p>
                ) : null}
                {missingFulfillmentCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    {missingFulfillmentCount} seçili üründe sevk süresi eksik veya geçersiz.
                  </p>
                ) : null}
                {missingColorCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    {missingColorCount} seçili üründe renk seçimi bekleniyor.
                  </p>
                ) : null}
                {missingMaterialCount > 0 ? (
                  <p style={{ color: 'var(--color-destructive)' }}>
                    {missingMaterialCount} seçili üründe materyal seçimi bekleniyor.
                  </p>
                ) : null}
              </div>

              <CategorySupportHint />

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr>
                      {[
                        'Seç',
                        'Ürün',
                        'Model Kodu',
                        'Barkod',
                        'Stok',
                        'Sevk',
                        'Hipicon kategorisi',
                        'Hedef kategori',
                        'Renk',
                        'Materyal',
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
                      const s = selections[item.externalId] ?? createEmptySelectionState()
                      const hasVariants = (item.variants?.length ?? 0) > 0
                      const proposal = item.resolvedCategoryProposal
                      const importedProduct = importedByExternalId[item.externalId]
                      const attributeCategoryId = s.categoryId || proposal?.parentId || ''
                      const attributeOptions = attributeCategoryId
                        ? attributeOptionsByCategoryId[attributeCategoryId]
                        : undefined
                      const attributeLoading = attributeCategoryId
                        ? Boolean(attributeLoadingByCategoryId[attributeCategoryId])
                        : false

                      const categoryDisplay = proposal
                        ? null // handled separately
                        : s.categoryId
                          ? (categoryNameById.get(s.categoryId) ?? s.categoryId)
                          : ''
                      const selectedColorLabel =
                        attributeOptions?.colorOptions.find((option) => option.id === s.colorOptionId)?.label ?? ''
                      const selectedMaterialLabel =
                        attributeOptions?.materialOptions.find((option) => option.id === s.materialOptionId)?.label ?? ''

                      return (
                        <tr key={item.externalId} style={{ opacity: importedProduct ? 0.72 : 1 }}>
                          {/* Checkbox */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <Checkbox
                              checked={importedProduct ? false : s.selected}
                              onCheckedChange={(checked) =>
                                updateItemSelection(item.externalId, (cur) => ({
                                  ...cur,
                                  selected: checked === true,
                                }))
                              }
                              disabled={Boolean(importedProduct)}
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
                                {importedProduct ? (
                                  <p className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                                    Başarıyla eklendi
                                  </p>
                                ) : null}
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  {item.imageUrls.length} görsel
                                </p>
                                <ProductDetail item={item} />
                              </div>
                            </div>
                          </td>

                          {/* Model code */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <Input
                              value={s.modelCode}
                              onChange={(event) =>
                                updateItemSelection(item.externalId, (current) => ({
                                  ...current,
                                  modelCode: event.target.value,
                                }))
                              }
                              disabled={!s.selected || isBusy || Boolean(importedProduct)}
                              placeholder="Model Kodu"
                              className="min-w-[140px] text-xs"
                              aria-label={`${item.name} Model Kodu`}
                            />
                            <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                              Kaynak SKU'dan önerildi; aynı modelin renk/materyal kardeşlerinde aynı kodu kullanın.
                            </p>
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
                              isBusy={isBusy || Boolean(importedProduct)}
                              onBarcodeChange={handleBarcodeChange}
                            />
                          </td>

                          {/* Stock */}
                          <td
                            className="border-b px-3 py-3 align-top text-center"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                          >
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={String(s.stockQuantity)}
                              onChange={(event) =>
                                updateItemSelection(item.externalId, (current) => ({
                                  ...current,
                                  stockQuantity: Math.max(
                                    0,
                                    Number.parseInt(event.target.value || '0', 10) || 0,
                                  ),
                                }))
                              }
                              disabled={!s.selected || isBusy || Boolean(importedProduct)}
                              className="mx-auto w-24 text-center"
                            />
                          </td>

                          <td
                            className="border-b px-3 py-3 align-top text-center"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                          >
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              placeholder="Gün"
                              value={s.fulfillmentDays > 0 ? String(s.fulfillmentDays) : ''}
                              onChange={(event) =>
                                updateItemSelection(item.externalId, (current) => ({
                                  ...current,
                                  fulfillmentDays: Math.max(
                                    0,
                                    Number.parseInt(event.target.value || '0', 10) || 0,
                                  ),
                                }))
                              }
                              disabled={!s.selected || isBusy || Boolean(importedProduct)}
                              className="mx-auto w-24 text-center"
                            />
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
                                  onChange={(e) => {
                                    const nextCategoryId = e.target.value
                                    updateItemSelection(item.externalId, (cur) => ({
                                      ...cur,
                                      categoryId: nextCategoryId,
                                      colorOptionId: '',
                                      materialOptionId: '',
                                    }))
                                    if (nextCategoryId) {
                                      void ensureAttributeOptionsLoaded(nextCategoryId)
                                    }
                                  }}
                                  disabled={Boolean(importedProduct) || !s.selected || isBusy}
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

                          {/* Color */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="min-w-[180px] space-y-2">
                              <label htmlFor={`color-${item.externalId}`} className="sr-only">
                                Renk
                              </label>
                              <select
                                id={`color-${item.externalId}`}
                                value={s.colorOptionId}
                                onChange={(e) =>
                                  updateItemSelection(item.externalId, (cur) => ({
                                    ...cur,
                                    colorOptionId: e.target.value,
                                  }))
                                }
                                disabled={
                                  Boolean(importedProduct) ||
                                  !s.selected ||
                                  isBusy ||
                                  !attributeCategoryId ||
                                  attributeLoading
                                }
                                className="w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                style={{
                                  borderColor: 'var(--color-border)',
                                  backgroundColor: 'var(--color-surface)',
                                }}
                              >
                                <option value="">
                                  {!attributeCategoryId
                                    ? '-- Önce kategori seçin --'
                                    : attributeLoading
                                      ? '-- Renkler yükleniyor --'
                                      : '-- Renk seçin --'}
                                </option>
                                {(attributeOptions?.colorOptions ?? []).map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {!attributeCategoryId ? (
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  Önce kategori seçin.
                                </p>
                              ) : selectedColorLabel ? (
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  {selectedColorLabel}
                                </p>
                              ) : null}
                            </div>
                          </td>

                          {/* Material */}
                          <td
                            className="border-b px-3 py-3 align-top"
                            style={{ borderColor: 'var(--color-border)' }}
                          >
                            <div className="min-w-[180px] space-y-2">
                              <label htmlFor={`material-${item.externalId}`} className="sr-only">
                                Materyal
                              </label>
                              <select
                                id={`material-${item.externalId}`}
                                value={s.materialOptionId}
                                onChange={(e) =>
                                  updateItemSelection(item.externalId, (cur) => ({
                                    ...cur,
                                    materialOptionId: e.target.value,
                                  }))
                                }
                                disabled={
                                  Boolean(importedProduct) ||
                                  !s.selected ||
                                  isBusy ||
                                  !attributeCategoryId ||
                                  attributeLoading
                                }
                                className="w-full rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                                style={{
                                  borderColor: 'var(--color-border)',
                                  backgroundColor: 'var(--color-surface)',
                                }}
                              >
                                <option value="">
                                  {!attributeCategoryId
                                    ? '-- Önce kategori seçin --'
                                    : attributeLoading
                                      ? '-- Materyaller yükleniyor --'
                                      : '-- Materyal seçin --'}
                                </option>
                                {(attributeOptions?.materialOptions ?? []).map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              {!attributeCategoryId ? (
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  Önce kategori seçin.
                                </p>
                              ) : selectedMaterialLabel ? (
                                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                  {selectedMaterialLabel}
                                </p>
                              ) : null}
                            </div>
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
