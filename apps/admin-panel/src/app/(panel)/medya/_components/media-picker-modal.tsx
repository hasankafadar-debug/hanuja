'use client'

import { X } from 'lucide-react'
import { MediaLibraryClient } from './media-library-client'
import type { MediaAssetItem } from './types'

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (asset: MediaAssetItem) => void
  acceptKind?: 'image' | 'video' | 'all'
  folder?: string
}

export function MediaPickerModal({ open, onClose, onSelect, acceptKind = 'all', folder }: Props) {
  if (!open) return null

  const handleSelect = (asset: MediaAssetItem) => {
    onSelect(asset)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
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
            className="text-lg font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            Medyadan Seç
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <MediaLibraryClient
          selectionMode
          onAssetSelect={handleSelect}
          acceptKind={acceptKind}
          {...(folder ? { initialFolder: folder } : {})}
        />
      </div>
    </div>
  )
}
