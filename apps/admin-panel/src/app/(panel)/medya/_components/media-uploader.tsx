'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@hanuja/ui'
import type { MediaAssetItem } from './types'

const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ACCEPTED_VIDEO_TYPES = ['video/mp4', 'video/webm']
const MAX_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

const FOLDER_OPTIONS = [
  { value: 'slider', label: 'Slider' },
  { value: 'promo', label: 'Promo' },
  { value: 'blog', label: 'Blog' },
  { value: 'general', label: 'Genel' },
]

interface Props {
  onSuccess: (asset: MediaAssetItem) => void
  folder?: string
}

export function MediaUploader({ onSuccess, folder: defaultFolder }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder ?? 'general')
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setFile(null)
    setProgress(0)
    setError(null)
    setUploading(false)
  }

  const validateFile = useCallback(
    (f: File): string | null => {
      const isVideo = ACCEPTED_VIDEO_TYPES.includes(f.type)
      const isImage = ACCEPTED_IMAGE_TYPES.includes(f.type)

      if (!isImage && !isVideo) {
        return 'Yalnızca JPEG, PNG, WebP görsel veya MP4/WebM video yüklenebilir.'
      }
      if (isVideo && selectedFolder !== 'slider') {
        return 'Video yüklemesi yalnızca Slider klasörü için desteklenir.'
      }
      if (f.size > MAX_SIZE_BYTES) {
        return `Dosya boyutu 10 MB sınırını aşıyor (${(f.size / 1024 / 1024).toFixed(1)} MB).`
      }
      return null
    },
    [selectedFolder],
  )

  const handleFile = useCallback(
    (f: File) => {
      const err = validateFile(f)
      if (err) {
        setError(err)
        return
      }
      setError(null)
      setFile(f)
    },
    [validateFile],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const dropped = e.dataTransfer.files[0]
      if (dropped) handleFile(dropped)
    },
    [handleFile],
  )

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    setProgress(10)

    try {
      // 1. Presigned URL al
      const urlRes = await fetch('/api/admin/media/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder: selectedFolder,
          mimeType: file.type,
          originalName: file.name,
        }),
      })
      if (!urlRes.ok) {
        const data = await urlRes.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? 'Yükleme URL\'i alınamadı.')
      }
      const uploadData = (await urlRes.json()) as {
        data?: { uploadUrl: string; asset?: { id: string }; assetId?: string }
        uploadUrl?: string
        asset?: { id: string }
        assetId?: string
      }
      const uploadPayload = uploadData.data ?? uploadData
      const uploadUrl = uploadPayload.uploadUrl
      const assetId = uploadPayload.assetId ?? uploadPayload.asset?.id
      if (!uploadUrl || !assetId) throw new Error('YÃ¼kleme URL bilgisi eksik.')

      setProgress(30)

      // 2. R2'ye yükle
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      })
      if (!uploadRes.ok) throw new Error('Dosya yüklenemedi.')

      setProgress(75)

      // 3. Confirm
      const confirmRes = await fetch(`/api/admin/media/${assetId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!confirmRes.ok) {
        const data = await confirmRes.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? 'Dosya doğrulanamadı.')
      }
      const confirmData = (await confirmRes.json()) as {
        data?: { asset: MediaAssetItem }
        asset?: MediaAssetItem
      }
      const asset = confirmData.data?.asset ?? confirmData.asset
      if (!asset) throw new Error('Medya kaydÄ± okunamadÄ±.')

      setProgress(100)
      onSuccess(asset)
      reset()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata.')
      setUploading(false)
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}
      >
        <Upload className="mr-2 h-4 w-4" />
        Yükle
      </Button>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="w-full max-w-md rounded-xl p-6 shadow-2xl"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        {/* Başlık */}
        <div className="mb-4 flex items-center justify-between">
          <h2
            className="text-lg font-semibold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
          >
            Medya Yükle
          </h2>
          <button
            type="button"
            onClick={() => { reset(); setOpen(false) }}
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Klasör seçici (defaultFolder yoksa göster) */}
        {!defaultFolder && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Klasör
            </label>
            <select
              value={selectedFolder}
              onChange={(e) => { setSelectedFolder(e.target.value); setFile(null); setError(null) }}
              className="w-full rounded-md border px-3 py-2 text-sm"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-background)',
                color: 'var(--color-primary)',
              }}
            >
              {FOLDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {selectedFolder === 'slider' && (
              <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                Slider klasörü görsel ve video (MP4/WebM, max 15 sn) kabul eder.
              </p>
            )}
          </div>
        )}

        {/* Drop zone */}
        <div
          className="mb-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 transition-colors"
          style={{ borderColor: 'var(--color-border)' }}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="mb-2 h-8 w-8" style={{ color: 'var(--color-muted-fg)' }} />
          {file ? (
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{file.name}</p>
          ) : (
            <>
              <p className="text-sm" style={{ color: 'var(--color-primary)' }}>
                Dosya sürükleyin veya tıklayın
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                JPEG, PNG, WebP{selectedFolder === 'slider' ? ', MP4, WebM' : ''} — max 10 MB
              </p>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept={[
              ...ACCEPTED_IMAGE_TYPES,
              ...(selectedFolder === 'slider' ? ACCEPTED_VIDEO_TYPES : []),
            ].join(',')}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </div>

        {/* Progress */}
        {uploading && (
          <div className="mb-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--color-border)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, backgroundColor: 'var(--color-accent)' }}
              />
            </div>
            <p className="mt-1 text-right text-xs" style={{ color: 'var(--color-muted-fg)' }}>{progress}%</p>
          </div>
        )}

        {/* Hata */}
        {error && (
          <p className="mb-4 rounded-md px-3 py-2 text-sm" style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}>
            {error}
          </p>
        )}

        {/* Aksiyon butonları */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => { reset(); setOpen(false) }}
            className="flex-1"
            disabled={uploading}
          >
            İptal
          </Button>
          <Button
            onClick={handleUpload}
            className="flex-1"
            disabled={!file || uploading}
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-fg)' }}
          >
            {uploading ? 'Yükleniyor…' : 'Yükle'}
          </Button>
        </div>
      </div>
    </div>
  )
}
