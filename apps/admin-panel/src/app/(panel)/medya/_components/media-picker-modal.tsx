'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { MediaLibraryClient } from './media-library-client'
import type { MediaLibrarySource } from './media-library-client'
import type { MediaAssetItem } from './types'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (asset: MediaAssetItem) => void
  acceptKind?: 'image' | 'video' | 'all'
  folder?: string
  allowSellerProducts?: boolean
}

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  acceptKind = 'all',
  folder,
  allowSellerProducts = false,
}: Props) {
  const [source, setSource] = useState<MediaLibrarySource>('admin')

  if (!open) return null

  const handleClose = () => {
    setSource('admin')
    onClose()
  }

  const handleSelect = (asset: MediaAssetItem) => {
    onSelect(asset)
    handleClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-picker-title"
    >
      <div
        className="w-full max-w-4xl rounded-xl p-6 shadow-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
        }}
      >
        {/* Başlık */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="media-picker-title"
            className="text-lg font-semibold"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--color-primary)',
            }}
          >
            Medyadan Seç
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Medya seçiciyi kapat"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {allowSellerProducts && (
          <div
            className="mb-4 flex w-fit rounded-md border p-1"
            role="tablist"
            aria-label="Medya kaynağı"
            style={{ borderColor: 'var(--color-border)' }}
          >
            {(
              [
                { value: 'admin', label: 'Admin Medyası' },
                { value: 'seller-products', label: 'Satıcı Ürünleri' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={source === tab.value}
                onClick={() => setSource(tab.value)}
                className="rounded px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: source === tab.value ? 'var(--color-accent)' : 'transparent',
                  color: source === tab.value ? 'white' : 'var(--color-primary)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <MediaLibraryClient
          key={`${source}-${acceptKind}-${folder ?? 'all'}`}
          selectionMode
          onAssetSelect={handleSelect}
          source={source}
          acceptKind={source === 'seller-products' ? 'image' : acceptKind}
          {...(source === 'admin' && folder ? { initialFolder: folder } : {})}
        />
      </div>
    </div>
  )
}
