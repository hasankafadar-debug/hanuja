'use client'

import Image from 'next/image'
import { Film, Trash2, Check } from 'lucide-react'
import { normalizeMediaDisplayUrl } from '@hanuja/ui'
import type { MediaAssetItem } from './types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

interface Props {
  asset: MediaAssetItem
  onSelect?: ((asset: MediaAssetItem) => void) | undefined
  onDelete?: ((id: string) => void) | undefined
  selectable?: boolean | undefined
  selected?: boolean | undefined
}

export function MediaAssetCard({ asset, onSelect, onDelete, selectable, selected }: Props) {
  const thumbUrl = asset.variants?.['400w'] ?? asset.variants?.['800w'] ?? asset.url
  const displayThumbUrl = normalizeMediaDisplayUrl(thumbUrl)

  const isVideo = asset.kind === 'video'

  return (
    <div
      className={`group relative overflow-hidden rounded-md border ${selectable ? 'cursor-pointer' : ''}`}
      style={{
        borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)',
        backgroundColor: 'var(--color-surface)',
        boxShadow: selected ? '0 0 0 2px var(--color-accent)' : undefined,
      }}
      onClick={() => onSelect?.(asset)}
      onKeyDown={(event) => {
        if (selectable && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect?.(asset)
        }
      }}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
    >
      {/* Thumbnail area */}
      <div className="relative aspect-square bg-gray-100">
        {isVideo ? (
          <div
            className="flex h-full items-center justify-center"
            style={{ backgroundColor: 'var(--color-muted)' }}
          >
            <Film className="h-10 w-10" style={{ color: 'var(--color-muted-fg)' }} />
          </div>
        ) : (
          <Image
            src={displayThumbUrl}
            alt={asset.product?.name ?? asset.originalName ?? 'Medya'}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
            className="h-full w-full object-cover"
            unoptimized={displayThumbUrl.startsWith('/api/media/fetch?')}
          />
        )}

        {/* Video rozeti */}
        {isVideo && (
          <span
            className="absolute right-1 top-1 rounded px-1.5 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            video
          </span>
        )}

        {/* Video süre rozeti */}
        {isVideo && asset.durationSec != null && (
          <span
            className="absolute bottom-1 left-1 rounded px-1 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
          >
            {formatDuration(asset.durationSec)}
          </span>
        )}

        {/* Seçim checkmark */}
        {selectable && selected && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}
          >
            <Check className="h-8 w-8 text-white" />
          </div>
        )}

        {/* Hover overlay — ad ve boyut */}
        <div
          className="absolute inset-0 flex flex-col justify-end p-2 opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 60%)',
          }}
        >
          <p className="truncate text-xs text-white">{asset.originalName ?? '—'}</p>
          {asset.sizeBytes != null && (
            <p className="text-xs text-white/80">{formatBytes(asset.sizeBytes)}</p>
          )}
        </div>
      </div>

      {asset.product && asset.seller && (
        <div
          className="space-y-0.5 border-t px-2 py-1.5"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="truncate text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
            {asset.product.name}
          </p>
          <p className="truncate text-[11px]" style={{ color: 'var(--color-muted-fg)' }}>
            {asset.seller.displayName} · {asset.product.modelCode}
          </p>
        </div>
      )}

      {/* Silme butonu */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(asset.id)
          }}
          className="absolute right-1 top-1 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            backgroundColor: 'var(--color-destructive)',
            color: 'white',
          }}
          title="Sil"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
