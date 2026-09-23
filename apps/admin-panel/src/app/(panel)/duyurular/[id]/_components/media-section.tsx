'use client'

import { useRef, useState } from 'react'
import { Button } from '@hanuja/ui'
import { uploadAdminMedia } from '@/lib/admin-media-upload'

const IMAGE_TYPES = ['image/jpeg', 'image/png']
const VIDEO_TYPES = ['video/mp4', 'video/webm']
const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const VIDEO_MAX_BYTES = 50 * 1024 * 1024

export interface MediaState {
  mediaAssetId: string | null
  mediaKind: 'image' | 'video' | null
  mediaUrl: string | null
  posterAssetId: string | null
  posterUrl: string | null
}

interface MediaSectionProps {
  value: MediaState
  onChange: (next: MediaState) => void
  disabled?: boolean
}

function validateFile(file: File, allowed: string[], maxBytes: number, label: string): string | null {
  if (!allowed.includes(file.type)) return `${label} için desteklenmeyen dosya türü.`
  if (file.size > maxBytes) return `${label} en fazla ${Math.round(maxBytes / (1024 * 1024))} MB olabilir.`
  return null
}

export function MediaSection({ value, onChange, disabled }: MediaSectionProps) {
  const [mode, setMode] = useState<'image' | 'video'>(value.mediaKind ?? 'image')
  const [uploading, setUploading] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const posterInputRef = useRef<HTMLInputElement | null>(null)

  async function handleMediaFile(file: File) {
    const validationError =
      mode === 'image'
        ? validateFile(file, IMAGE_TYPES, IMAGE_MAX_BYTES, 'Görsel')
        : validateFile(file, VIDEO_TYPES, VIDEO_MAX_BYTES, 'Video')
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setUploading('media')
    setProgress(0)
    try {
      const asset = await uploadAdminMedia(file, 'announcements', setProgress)
      onChange({
        mediaAssetId: asset.id,
        mediaKind: mode,
        mediaUrl: asset.url,
        posterAssetId: mode === 'image' ? null : value.posterAssetId,
        posterUrl: mode === 'image' ? null : value.posterUrl,
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Dosya yüklenemedi.')
    } finally {
      setUploading(null)
    }
  }

  async function handlePosterFile(file: File) {
    const validationError = validateFile(file, IMAGE_TYPES, IMAGE_MAX_BYTES, 'Kapak görseli')
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setUploading('poster')
    setProgress(0)
    try {
      const asset = await uploadAdminMedia(file, 'announcements', setProgress)
      onChange({ ...value, posterAssetId: asset.id, posterUrl: asset.url })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kapak görseli yüklenemedi.')
    } finally {
      setUploading(null)
    }
  }

  function handleRemoveMedia() {
    setError(null)
    onChange({ mediaAssetId: null, mediaKind: null, mediaUrl: null, posterAssetId: null, posterUrl: null })
  }

  function handleRemovePoster() {
    setError(null)
    onChange({ ...value, posterAssetId: null, posterUrl: null })
  }

  const hasMedia = value.mediaKind !== null

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
        Medya (opsiyonel)
      </p>

      {!hasMedia && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Medya türü">
          {(['image', 'video'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              disabled={disabled || uploading !== null}
              onClick={() => setMode(option)}
              className="rounded-full border px-3 py-1.5 text-sm font-medium"
              style={{
                borderColor: mode === option ? 'var(--color-primary)' : 'var(--color-border)',
                backgroundColor: mode === option ? 'var(--color-primary)' : 'transparent',
                color: mode === option ? 'var(--color-primary-fg)' : 'var(--color-muted-fg)',
              }}
            >
              {option === 'image' ? 'Görsel' : 'Video'}
            </button>
          ))}
        </div>
      )}

      {!hasMedia && (
        <div className="space-y-2">
          <label
            htmlFor="announcement-media-file"
            className="block text-sm"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            {mode === 'image' ? 'Görsel dosyası (JPEG/PNG, en fazla 10 MB)' : 'Video dosyası (MP4/WEBM, en fazla 50 MB)'}
          </label>
          <input
            id="announcement-media-file"
            ref={fileInputRef}
            type="file"
            accept={mode === 'image' ? IMAGE_TYPES.join(',') : VIDEO_TYPES.join(',')}
            disabled={disabled || uploading !== null}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleMediaFile(file)
              event.target.value = ''
            }}
            className="block w-full text-sm"
          />
          {mode === 'video' && (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              MP4 (H.264/AAC) önerilir.
            </p>
          )}
        </div>
      )}

      {hasMedia && value.mediaKind === 'image' && value.mediaUrl && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- fresh upload preview, not a page image */}
          <img
            src={value.mediaUrl}
            alt="Duyuru görseli"
            className="max-h-72 w-full rounded-lg border object-contain"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
          />
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleRemoveMedia}>
            Kaldır
          </Button>
        </div>
      )}

      {hasMedia && value.mediaKind === 'video' && (
        <div className="space-y-3">
          {value.mediaUrl && (
            <video
              controls
              playsInline
              preload="metadata"
              poster={value.posterUrl ?? undefined}
              src={value.mediaUrl}
              className="max-h-72 w-full rounded-lg border bg-black"
              style={{ borderColor: 'var(--color-border)' }}
            >
              Tarayıcınız video oynatmayı desteklemiyor.
            </video>
          )}
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleRemoveMedia}>
            Videoyu kaldır
          </Button>

          <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Kapak görseli (e-postada gösterilir)
            </p>
            {value.posterUrl ? (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- fresh upload preview, not a page image */}
                <img
                  src={value.posterUrl}
                  alt="Video kapak görseli"
                  className="max-h-48 w-full rounded-lg border object-contain"
                  style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
                />
                <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={handleRemovePoster}>
                  Kapak görselini kaldır
                </Button>
              </div>
            ) : (
              <input
                ref={posterInputRef}
                type="file"
                accept={IMAGE_TYPES.join(',')}
                disabled={disabled || uploading !== null}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handlePosterFile(file)
                  event.target.value = ''
                }}
                className="block w-full text-sm"
                aria-label="Kapak görseli yükle"
              />
            )}
          </div>
        </div>
      )}

      {uploading && (
        <div className="space-y-1">
          <div className="h-2 w-full rounded-full" style={{ backgroundColor: 'var(--color-muted)' }}>
            <div
              className="h-2 rounded-full transition-all"
              style={{ width: `${progress}%`, backgroundColor: 'var(--color-primary)' }}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            {uploading === 'poster' ? 'Kapak görseli yükleniyor' : 'Dosya yükleniyor'} — %{progress}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      )}

      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Medya bağlantısını alan herkes görüntüleyebilir; gizli bilgi içeren medya yüklemeyin.
      </p>
    </div>
  )
}
