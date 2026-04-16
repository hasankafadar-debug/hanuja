'use client'

import * as React from 'react'
import { Upload, X, ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '../../lib/utils'

export type UploadFolder = 'products' | 'stores' | 'avatars' | 'disputes' | 'returns' | 'blog'

export interface UploadedAsset {
  id: string
  url: string
  key: string
  originalName?: string
}

interface UploadState {
  file: File
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'error'
  progress: number
  error?: string
  asset?: UploadedAsset
}

export interface FileUploadProps {
  /** API path for requesting presigned URLs — defaults to '/api/media' */
  apiPath?: string
  folder: UploadFolder
  /** Max number of files that can be uploaded at once */
  maxFiles?: number
  /** Already uploaded assets (controlled) */
  value?: UploadedAsset[]
  onChange?: (assets: UploadedAsset[]) => void
  className?: string
  /** Show preview thumbnails */
  showPreviews?: boolean
  disabled?: boolean
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

/**
 * FileUpload — drag & drop or click-to-select image uploader.
 *
 * Flow: request presigned URL → upload to R2 → confirm → notify parent via onChange.
 * Uses the presigned-URL pattern — files go directly to R2, not through the Next.js server.
 */
export function FileUpload({
  apiPath = '/api/media',
  folder,
  maxFiles = 5,
  value = [],
  onChange,
  className,
  showPreviews = true,
  disabled = false,
}: FileUploadProps) {
  const [uploads, setUploads] = React.useState<UploadState[]>([])
  const [isDragOver, setIsDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const canAddMore = value.length + uploads.filter((u) => u.status === 'done').length < maxFiles

  function validateFile(file: File): string | null {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `Desteklenmeyen dosya türü: ${file.type}. Yalnızca JPEG, PNG, WebP, GIF yükleyin.`
    }
    if (file.size > MAX_FILE_SIZE) {
      return `Dosya boyutu çok büyük. Maksimum 10 MB yükleyebilirsiniz.`
    }
    return null
  }

  async function uploadFile(file: File) {
    const _stateId = `${file.name}-${Date.now()}`

    setUploads((prev) => [
      ...prev,
      { file, status: 'pending', progress: 0 },
    ])

    const validationError = validateFile(file)
    if (validationError) {
      setUploads((prev) =>
        prev.map((u) =>
          u.file === file ? { ...u, status: 'error', error: validationError } : u,
        ),
      )
      return
    }

    try {
      // 1. Request presigned URL
      setUploads((prev) =>
        prev.map((u) => (u.file === file ? { ...u, status: 'uploading', progress: 10 } : u)),
      )

      const urlRes = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder,
          mimeType: file.type,
          originalName: file.name,
        }),
      })

      if (!urlRes.ok) throw new Error('Yükleme URL\'si alınamadı.')
      const { data } = await urlRes.json()
      const { asset, uploadUrl } = data

      // 2. Upload directly to R2 using presigned URL
      setUploads((prev) =>
        prev.map((u) => (u.file === file ? { ...u, progress: 40 } : u)),
      )

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })

      if (!uploadRes.ok) throw new Error('Dosya yüklenemedi.')

      setUploads((prev) =>
        prev.map((u) => (u.file === file ? { ...u, status: 'confirming', progress: 80 } : u)),
      )

      // 3. Confirm upload
      const confirmRes = await fetch(`${apiPath}/${asset.id}/confirm`, { method: 'POST' })
      if (!confirmRes.ok) throw new Error('Yükleme doğrulanamadı.')
      const { data: confirmedAsset } = await confirmRes.json()

      setUploads((prev) =>
        prev.map((u) =>
          u.file === file
            ? { ...u, status: 'done', progress: 100, asset: confirmedAsset }
            : u,
        ),
      )

      onChange?.([...value, confirmedAsset])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Yükleme başarısız.'
      setUploads((prev) =>
        prev.map((u) => (u.file === file ? { ...u, status: 'error', error: message } : u)),
      )
    }
  }

  function handleFiles(files: FileList | File[]) {
    if (disabled) return
    const fileArray = Array.from(files)
    const remaining = maxFiles - value.length
    fileArray.slice(0, remaining).forEach((f) => void uploadFile(f))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  function removeExisting(assetId: string) {
    onChange?.(value.filter((a) => a.id !== assetId))
  }

  function dismissError(file: File) {
    setUploads((prev) => prev.filter((u) => u.file !== file))
  }

  const activeUploads = uploads.filter((u) => u.status !== 'done' && u.status !== 'error')
  const errorUploads = uploads.filter((u) => u.status === 'error')

  return (
    <div className={cn('space-y-3', className)}>
      {/* Drop zone */}
      {canAddMore && !disabled && (
        <div
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/30',
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          aria-label="Dosya yüklemek için tıklayın veya sürükleyin"
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm font-medium">Dosyayı sürükle veya tıkla</p>
          <p className="text-xs text-muted-foreground mt-1">
            JPEG, PNG, WebP, GIF — Maks. 10 MB
            {maxFiles > 1 && ` — En fazla ${maxFiles} dosya`}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            multiple={maxFiles > 1}
            className="sr-only"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>
      )}

      {/* Existing assets */}
      {showPreviews && value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((asset) => (
            <div key={asset.id} className="relative group w-20 h-20">
              <img
                src={asset.url}
                alt={asset.originalName ?? 'Yüklenen görsel'}
                className="w-full h-full object-cover rounded-md border border-border"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeExisting(asset.id)}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Görseli kaldır"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Active upload progress */}
      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map((u) => (
            <div key={u.file.name} className="flex items-center gap-3 text-sm">
              {u.status === 'uploading' || u.status === 'confirming' ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="truncate text-xs">{u.file.name}</p>
                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
              </div>
              <span className="text-xs text-muted-foreground flex-shrink-0">{u.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Errors */}
      {errorUploads.length > 0 && (
        <div className="space-y-1">
          {errorUploads.map((u) => (
            <div
              key={u.file.name}
              className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">{u.file.name}: </span>
                <span>{u.error}</span>
              </div>
              <button
                type="button"
                onClick={() => dismissError(u.file)}
                className="flex-shrink-0 hover:text-destructive/70"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
