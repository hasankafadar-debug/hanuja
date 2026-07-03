'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  FileUpload,
  normalizeMediaDisplayUrl,
  type UploadedAsset,
} from '@hanuja/ui'
import {
  CheckSquare,
  Copy,
  Download,
  ImageIcon,
  Square,
  Trash2,
} from 'lucide-react'

interface MediaAssetRecord {
  id: string
  url: string
  shareUrl?: string
  originalName?: string | null
  createdAt: string
}

interface MediaListResponse {
  items: MediaAssetRecord[]
  total: number
  hasMore: boolean
  nextSkip: number
}

const PAGE_SIZE = 30

function mergeAssets(current: MediaAssetRecord[], incoming: MediaAssetRecord[]) {
  const existingIds = new Set(current.map((asset) => asset.id))
  return [...current, ...incoming.filter((asset) => !existingIds.has(asset.id))]
}

function getDownloadFileName(contentDisposition: string | null) {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/)
  return match?.[1] ?? 'medya-urlleri.xlsx'
}

export function MediaLibrary() {
  const [assets, setAssets] = useState<MediaAssetRecord[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [nextSkip, setNextSkip] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [uploads, setUploads] = useState<UploadedAsset[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const isLoadingRef = useRef(false)
  const lastAppendSkipRef = useRef<number | null>(null)

  const selectedCount = selectedIds.length
  const hasSelection = selectedCount > 0
  const selectedIdSet = new Set(selectedIds)

  async function loadAssets(options?: { append?: boolean; skip?: number }) {
    const append = options?.append ?? false
    const skip = options?.skip ?? 0

    if (isLoadingRef.current) return
    if (append && lastAppendSkipRef.current === skip) return

    isLoadingRef.current = true
    if (append) {
      lastAppendSkipRef.current = skip
    } else {
      lastAppendSkipRef.current = null
    }

    setIsLoading(true)
    try {
      const res = await fetch(`/api/media?folder=products&limit=${PAGE_SIZE}&skip=${skip}`, {
        cache: 'no-store',
      })
      const payload = (await res.json().catch(() => ({}))) as {
        data?: MediaListResponse
        message?: string
        error?: string
      }

      if (!res.ok) {
        if (append) lastAppendSkipRef.current = null
        setFeedback(payload.message ?? payload.error ?? 'Medya listesi yuklenemedi.')
        return
      }

      const data = payload.data
      if (!data) {
        if (append) lastAppendSkipRef.current = null
        return
      }

      setAssets((current) => (append ? mergeAssets(current, data.items) : data.items))
      setTotal(data.total)
      setHasMore(data.hasMore)
      setNextSkip(data.nextSkip)
    } catch {
      if (append) lastAppendSkipRef.current = null
      setFeedback('Medya listesi yuklenemedi.')
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadAssets()
  }, [])

  useEffect(() => {
    if (uploads.length === 0) return
    void loadAssets().finally(() => setUploads([]))
  }, [uploads])

  useEffect(() => {
    const node = loadMoreRef.current
    if (!node || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (!entry?.isIntersecting || isLoadingRef.current) return
        void loadAssets({ append: true, skip: nextSkip })
      },
      { rootMargin: '400px 0px' },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, nextSkip])

  function toggleSelection(assetId: string) {
    setSelectedIds((current) =>
      current.includes(assetId)
        ? current.filter((id) => id !== assetId)
        : [...current, assetId],
    )
  }

  function clearSelection() {
    setSelectedIds([])
  }

  function openDeleteDialog(assetIds: string[]) {
    if (assetIds.length === 0) return
    setDeleteTargetIds(assetIds)
  }

  function closeDeleteDialog() {
    if (isPending) return
    setDeleteTargetIds([])
  }

  async function handleDeleteConfirmed() {
    if (deleteTargetIds.length === 0) return

    const idsToDelete = [...deleteTargetIds]

    startTransition(async () => {
      setFeedback(null)

      const results = await Promise.allSettled(
        idsToDelete.map(async (assetId) => {
          const res = await fetch(`/api/media/${assetId}`, { method: 'DELETE' })
          if (!res.ok) {
            throw new Error(assetId)
          }
          return assetId
        }),
      )

      const deletedIds = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value)

      const failedCount = results.length - deletedIds.length

      if (deletedIds.length > 0) {
        const deletedIdSet = new Set(deletedIds)
        setAssets((current) => current.filter((asset) => !deletedIdSet.has(asset.id)))
        setSelectedIds((current) => current.filter((id) => !deletedIdSet.has(id)))
        setTotal((current) => Math.max(0, current - deletedIds.length))
      }

      setDeleteTargetIds([])

      if (deletedIds.length > 0 && failedCount === 0) {
        setFeedback(
          deletedIds.length === 1
            ? 'Gorsel silindi.'
            : `${deletedIds.length.toLocaleString('tr-TR')} gorsel silindi.`,
        )
        return
      }

      if (deletedIds.length > 0) {
        setFeedback(
          `${deletedIds.length.toLocaleString('tr-TR')} gorsel silindi, ${failedCount.toLocaleString('tr-TR')} gorsel silinemedi.`,
        )
        return
      }

      setFeedback('Secilen gorseller silinemedi.')
    })
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setFeedback('URL panoya kopyalandi.')
    } catch {
      setFeedback('URL kopyalanamadi.')
    }
  }

  async function handleExport() {
    if (assets.length === 0) return

    setIsExporting(true)
    setFeedback(null)

    try {
      const res = await fetch('/api/media/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hasSelection ? { ids: selectedIds } : {}),
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
        setFeedback(payload.error ?? payload.message ?? 'Excel indirilemedi.')
        return
      }

      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = getDownloadFileName(res.headers.get('Content-Disposition'))
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)

      setFeedback(
        hasSelection
          ? `${selectedCount.toLocaleString('tr-TR')} secili gorsel icin Excel indirildi.`
          : 'Tum gorsel URLleri Excel olarak indirildi.',
      )
    } catch {
      setFeedback('Excel indirilemedi.')
    } finally {
      setIsExporting(false)
    }
  }

  const singleDeleteAsset =
    deleteTargetIds.length === 1
      ? assets.find((asset) => asset.id === deleteTargetIds[0])
      : null

  return (
    <div className="space-y-6">
      <div className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          Yeni Gorsel Yukle
        </h2>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Tavsiye edilen boyut 1200×1200. Farkli oranda yüklerseniz sistem otomatik olarak 1:1'e tamamlar ve boş alanlar beyaz olur.
        </p>
        <div className="mt-4">
          <FileUpload
            folder="products"
            maxFiles={null}
            value={uploads}
            onChange={setUploads}
            showPreviews={false}
            showMaxFilesHint={false}
            imageConstraints={{
              minWidth: 800,
              minHeight: 800,
              maxWidth: 6000,
              maxHeight: 6000,
              allowedTypes: ['image/jpeg', 'image/png'],
            }}
            inputLabel="Medya gorseli yukle"
          />
        </div>
      </div>

      {feedback && (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {feedback}
        </p>
      )}

      <div
        className="space-y-3 rounded-xl border px-4 py-3"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Toplam {total.toLocaleString('tr-TR')} gorsel
            </p>
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Ilk yuklemede 5 satir gosterilir, asagi kaydikca eski gorseller otomatik gelir.
            </p>
          </div>
          {isLoading && (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Yukleniyor...
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium"
            style={{
              borderColor: hasSelection ? 'var(--color-primary)' : 'var(--color-border)',
              color: 'var(--color-primary)',
            }}
          >
            {hasSelection ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {hasSelection
              ? `${selectedCount.toLocaleString('tr-TR')} gorsel secili`
              : 'Secim yapmadan tum URLleri indirebilirsiniz'}
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!hasSelection} onClick={clearSelection}>
            Secimi Temizle
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={assets.length === 0 || isExporting}
            loading={isExporting}
            onClick={() => void handleExport()}
          >
            <Download className="h-4 w-4" />
            {hasSelection ? 'Secilenleri Excel Indir' : 'Tum URLleri Excel Indir'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={!hasSelection || isPending}
            onClick={() => openDeleteDialog(selectedIds)}
          >
            <Trash2 className="h-4 w-4" />
            Secilenleri Sil
          </Button>
        </div>
      </div>

      {assets.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="h-10 w-10" />}
          title="Henuz medya yok"
          description="Toplu yukleme veya import icin kullanacaginiz gorseller burada listelenecek."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {assets.map((asset) => {
              const isSelected = selectedIdSet.has(asset.id)
              const shareUrl = asset.shareUrl ?? asset.url

              return (
                <div
                  key={asset.id}
                  className="overflow-hidden rounded-lg border"
                  style={{
                    borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                  }}
                >
                  <div className="relative">
                    <button
                      type="button"
                      className="block aspect-square w-full p-2"
                      style={{ backgroundColor: 'var(--color-background)' }}
                      onClick={() => toggleSelection(asset.id)}
                      aria-pressed={isSelected}
                      aria-label={`${asset.originalName ?? 'Medya'} gorselini sec`}
                    >
                      <img
                        src={normalizeMediaDisplayUrl(asset.url)}
                        alt={asset.originalName ?? 'Medya'}
                        className="h-full w-full object-contain"
                      />
                    </button>
                    <div className="absolute left-2 top-2 rounded-md bg-white/90 p-1 shadow-sm">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelection(asset.id)}
                        aria-label={`${asset.originalName ?? 'Medya'} secimi`}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 p-2.5">
                    <div>
                      <p
                        className="truncate text-xs font-medium"
                        style={{ color: 'var(--color-primary)' }}
                        title={asset.originalName ?? 'Adsiz gorsel'}
                      >
                        {asset.originalName ?? 'Adsiz gorsel'}
                      </p>
                      <p
                        className="mt-1 truncate text-[11px]"
                        style={{ color: 'var(--color-muted-fg)' }}
                        title={shareUrl}
                      >
                        {shareUrl}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex-1 gap-1.5"
                        onClick={() => void handleCopy(shareUrl)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        URL
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="px-2"
                        disabled={isPending}
                        onClick={() => openDeleteDialog([asset.id])}
                        aria-label={`${asset.originalName ?? 'Medya'} gorselini sil`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <div ref={loadMoreRef} className="flex min-h-10 items-center justify-center">
            {hasMore ? (
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {isLoading ? 'Eski gorseller yukleniyor...' : 'Asagi kaydirinca eski gorseller gelir.'}
              </p>
            ) : (
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Tum gorseller yuklendi.
              </p>
            )}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteTargetIds.length > 0}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog()
        }}
        title={
          deleteTargetIds.length === 1
            ? 'Gorseli sil'
            : `${deleteTargetIds.length.toLocaleString('tr-TR')} gorseli sil`
        }
        description={
          deleteTargetIds.length === 1
            ? `"${singleDeleteAsset?.originalName ?? 'Secili gorsel'}" kalici olarak silinecek.`
            : 'Secili gorseller kalici olarak silinecek.'
        }
        confirmLabel="Sil"
        cancelLabel="Vazgec"
        loading={isPending}
        onConfirm={() => void handleDeleteConfirmed()}
      />
    </div>
  )
}
