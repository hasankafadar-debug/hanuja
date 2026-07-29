'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, Input, Skeleton } from '@hanuja/ui'
import { MediaAssetCard } from './media-asset-card'
import { MediaUploader } from './media-uploader'
import type { MediaAssetItem } from './types'

export type MediaLibrarySource = 'admin' | 'seller-products'

const KIND_OPTIONS = [
  { value: 'all', label: 'Tümü' },
  { value: 'image', label: 'Görsel' },
  { value: 'video', label: 'Video' },
]

const FOLDER_OPTIONS = [
  { value: 'all', label: 'Tümü' },
  { value: 'slider', label: 'Slider' },
  { value: 'promo', label: 'Promo' },
  { value: 'blog', label: 'Blog' },
  { value: 'general', label: 'Genel' },
]

interface MediaLibraryClientProps {
  /** Seçim modu — media-picker-modal içinden çağrılırsa true */
  selectionMode?: boolean
  onAssetSelect?: (asset: MediaAssetItem) => void
  acceptKind?: 'image' | 'video' | 'all'
  initialFolder?: string
  source?: MediaLibrarySource
}

export function MediaLibraryClient({
  selectionMode = false,
  onAssetSelect,
  acceptKind = 'all',
  initialFolder = 'all',
  source = 'admin',
}: MediaLibraryClientProps) {
  const isSellerProducts = source === 'seller-products'
  const [kind, setKind] = useState<string>(
    isSellerProducts ? 'image' : acceptKind === 'all' ? 'all' : acceptKind,
  )
  const [folder, setFolder] = useState(initialFolder)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [assets, setAssets] = useState<MediaAssetItem[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Arama debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  const fetchAssets = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        source,
        page: String(page),
        ...(!isSellerProducts && kind !== 'all' ? { kind } : {}),
        ...(!isSellerProducts && folder !== 'all' ? { folder } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      })
      const res = await fetch(`/api/admin/media?${params.toString()}`)
      if (!res.ok) throw new Error('Medya yüklenemedi.')
      const data = (await res.json()) as {
        data?: { assets: MediaAssetItem[]; total: number; totalPages: number }
        assets?: MediaAssetItem[]
        total?: number
        totalPages?: number
      }
      const payload = data.data ?? data
      setAssets(payload.assets ?? [])
      setTotal(payload.total ?? 0)
      setTotalPages(payload.totalPages ?? 1)
    } catch {
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [source, isSellerProducts, kind, folder, debouncedSearch, page])

  useEffect(() => {
    void fetchAssets()
  }, [fetchAssets])

  // Filtre değişince sayfayı sıfırla
  useEffect(() => {
    setPage(1)
  }, [kind, folder, debouncedSearch])

  const handleDelete = async (id: string) => {
    if (!confirm('Bu medya dosyasını silmek istediğinizden emin misiniz?')) return
    const res = await fetch(`/api/admin/media/${id}`, { method: 'DELETE' })
    if (res.ok) {
      void fetchAssets()
    }
  }

  const handleSelect = (asset: MediaAssetItem) => {
    if (selectionMode) {
      setSelectedId(asset.id)
      onAssetSelect?.(asset)
    }
  }

  return (
    <div className="space-y-4">
      {/* Filtre bar + Yükle */}
      <div className="flex flex-wrap items-center gap-3">
        {!isSellerProducts && (
          <>
            {/* Tür toggle */}
            <div
              className="flex rounded-md border"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              {KIND_OPTIONS.filter(
                (o) => acceptKind === 'all' || o.value === 'all' || o.value === acceptKind,
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={kind === opt.value}
                  onClick={() => setKind(opt.value)}
                  className="px-3 py-1.5 text-sm transition-colors"
                  style={{
                    backgroundColor: kind === opt.value ? 'var(--color-accent)' : 'transparent',
                    color: kind === opt.value ? 'white' : 'var(--color-primary)',
                    borderRadius: '4px',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Klasör seçici */}
            <select
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="rounded-md border px-3 py-1.5 text-sm"
              aria-label="Medya klasörü"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-primary)',
              }}
            >
              {FOLDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}

        {/* Arama */}
        <Input
          placeholder={isSellerProducts ? 'Ürün, model veya satıcı ara…' : 'Dosya adı ara…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-48"
        />

        {/* Toplam */}
        {!loading && (
          <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {total} dosya
          </span>
        )}

        {!isSellerProducts && (
          <div className="ml-auto">
            <MediaUploader
              {...(folder !== 'all' ? { folder } : {})}
              onSuccess={(asset) => {
                if (selectionMode) onAssetSelect?.(asset)
                void fetchAssets()
              }}
            />
          </div>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg py-16 text-center"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Medya bulunamadı
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            {debouncedSearch || (!isSellerProducts && (kind !== 'all' || folder !== 'all'))
              ? 'Farklı filtre deneyin.'
              : isSellerProducts
                ? 'Yayındaki ürünlere bağlı satıcı görseli bulunmuyor.'
                : 'İlk dosyayı yüklemek için Yükle butonunu kullanın.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {assets.map((asset) => (
            <MediaAssetCard
              key={asset.id}
              asset={asset}
              {...(selectionMode ? { onSelect: handleSelect } : {})}
              {...(!selectionMode && !isSellerProducts
                ? {
                    onDelete: (id: string) => {
                      void handleDelete(id)
                    },
                  }
                : {})}
              selectable={selectionMode}
              selected={selectedId === asset.id}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
