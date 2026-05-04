'use client'

import * as React from 'react'
import { AlertCircle, ImageIcon, Loader2, Upload, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { normalizeMediaDisplayUrl } from '../../lib/media-url'
import { readImageFileMetadata } from './_lib/image-meta'

export type UploadFolder = 'products' | 'stores' | 'avatars' | 'disputes' | 'returns' | 'blog' | 'documents'

export interface UploadedAsset {
  id: string
  url: string
  key: string
  originalName?: string
}

interface UploadState {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'confirming' | 'done' | 'error'
  progress: number
  error?: string
  asset?: UploadedAsset
}

export interface ImageConstraints {
  exactWidth?: number
  exactHeight?: number
  minDpi?: number
  maxDpi?: number
  allowedTypes?: string[]
}

export interface FileUploadProps {
  apiPath?: string
  folder: UploadFolder
  maxFiles?: number | null
  value?: UploadedAsset[]
  onChange?: (assets: UploadedAsset[]) => void
  className?: string
  showPreviews?: boolean
  showMaxFilesHint?: boolean
  disabled?: boolean
  imageConstraints?: ImageConstraints
  inputLabel?: string
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const DOCUMENT_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const MAX_FILE_SIZE = 10 * 1024 * 1024
const DOCUMENT_MAX_FILE_SIZE = 20 * 1024 * 1024

function formatDpi(dpi: number) {
  return Number.isInteger(dpi) ? String(dpi) : dpi.toFixed(2)
}

export function FileUpload({
  apiPath = '/api/media',
  folder,
  maxFiles = 5,
  value = [],
  onChange,
  className,
  showPreviews = true,
  showMaxFilesHint = true,
  disabled = false,
  imageConstraints,
  inputLabel = 'Dosya yükle',
}: FileUploadProps) {
  const [uploads, setUploads] = React.useState<UploadState[]>([])
  const [isDragOver, setIsDragOver] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  const acceptedTypes = imageConstraints?.allowedTypes?.length
    ? imageConstraints.allowedTypes
    : folder === 'documents'
      ? DOCUMENT_TYPES
    : ALLOWED_TYPES

  const hasFileLimit = typeof maxFiles === 'number'
  const canAddMore =
    !hasFileLimit ||
    value.length +
      uploads.filter(
        (upload) => upload.status !== 'done' && upload.status !== 'error',
      ).length <
      maxFiles

  async function validateFile(file: File): Promise<string | null> {
    if (!acceptedTypes.includes(file.type)) {
      return imageConstraints?.allowedTypes ? 'Yalnızca PNG veya JPEG kabul edilir.' : `Desteklenmeyen dosya türü: ${file.type}.`
    }

    const maxFileSize = folder === 'documents' ? DOCUMENT_MAX_FILE_SIZE : MAX_FILE_SIZE
    if (file.size > maxFileSize) {
      return `Dosya boyutu çok büyük. Maksimum ${Math.round(maxFileSize / 1024 / 1024)} MB yükleyebilirsiniz.`
    }

    if (!imageConstraints) return null

    const metadata = await readImageFileMetadata(file)

    if (
      imageConstraints.exactWidth !== undefined &&
      imageConstraints.exactHeight !== undefined &&
      (metadata.width !== imageConstraints.exactWidth || metadata.height !== imageConstraints.exactHeight)
    ) {
      return `Görsel çözünürlüğü tam olarak ${imageConstraints.exactWidth}×${imageConstraints.exactHeight} piksel olmalıdır (yüklenen: ${metadata.width}×${metadata.height}).`
    }

    if (imageConstraints.minDpi !== undefined || imageConstraints.maxDpi !== undefined) {
      if (metadata.dpi == null) {
        return 'Görselin DPI bilgisi okunamadı; 72-100 DPI olarak kaydedilmiş PNG/JPEG yükleyin.'
      }

      if (
        (imageConstraints.minDpi !== undefined && metadata.dpi < imageConstraints.minDpi) ||
        (imageConstraints.maxDpi !== undefined && metadata.dpi > imageConstraints.maxDpi)
      ) {
        return `Görsel DPI değeri ${imageConstraints.minDpi} ile ${imageConstraints.maxDpi} arasında olmalıdır (yüklenen: ${formatDpi(metadata.dpi)}).`
      }
    }

    return null
  }

  async function uploadFile(file: File) {
    const uploadId = crypto.randomUUID()
    setUploads((prev) => [...prev, { id: uploadId, file, status: 'pending', progress: 0 }])

    const validationError = await validateFile(file)
    if (validationError) {
      setUploads((prev) =>
        prev.map((upload) =>
          upload.id === uploadId ? { ...upload, status: 'error', error: validationError } : upload,
        ),
      )
      return
    }

    try {
      setUploads((prev) =>
        prev.map((upload) =>
          upload.id === uploadId ? { ...upload, status: 'uploading', progress: 10 } : upload,
        ),
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

      setUploads((prev) =>
        prev.map((upload) => (upload.id === uploadId ? { ...upload, progress: 40 } : upload)),
      )

      let uploadRes: Response
      try {
        uploadRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        })
      } catch {
        throw new Error('Dosya depolama alanına yüklenemedi. R2 yapılandırmasını kontrol edin.')
      }

      if (!uploadRes.ok) throw new Error('Dosya yüklenemedi.')

      setUploads((prev) =>
        prev.map((upload) =>
          upload.id === uploadId ? { ...upload, status: 'confirming', progress: 80 } : upload,
        ),
      )

      const confirmRes = await fetch(`${apiPath}/${asset.id}/confirm`, { method: 'POST' })
      const confirmPayload = await confirmRes.json().catch(() => ({}))
      if (!confirmRes.ok) {
        throw new Error(confirmPayload.error ?? 'Yükleme doğrulanamadı.')
      }
      const confirmedAsset = confirmPayload.data

      setUploads((prev) =>
        prev.map((upload) =>
          upload.id === uploadId
            ? { ...upload, status: 'done', progress: 100, asset: confirmedAsset }
            : upload,
        ),
      )

      onChange?.([...value, confirmedAsset])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yükleme başarısız.'
      setUploads((prev) =>
        prev.map((upload) =>
          upload.id === uploadId ? { ...upload, status: 'error', error: message } : upload,
        ),
      )
    }
  }

  function handleFiles(files: FileList | File[]) {
    if (disabled) return
    const fileArray = Array.from(files)
    const queue = hasFileLimit ? fileArray.slice(0, Math.max(0, maxFiles - value.length)) : fileArray
    queue.forEach((file) => void uploadFile(file))
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setIsDragOver(false)
    handleFiles(event.dataTransfer.files)
  }

  function removeExisting(assetId: string) {
    onChange?.(value.filter((asset) => asset.id !== assetId))
  }

  function dismissError(uploadId: string) {
    setUploads((prev) => prev.filter((upload) => upload.id !== uploadId))
  }

  const activeUploads = uploads.filter((upload) => upload.status !== 'done' && upload.status !== 'error')
  const errorUploads = uploads.filter((upload) => upload.status === 'error')

  return (
    <div className={cn('space-y-3', className)}>
      {canAddMore && !disabled && (
        <div
          className={cn(
            'cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            isDragOver
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/30',
          )}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
          aria-label="Dosya yüklemek için tıklayın veya sürükleyin"
        >
          <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Dosyayı sürükle veya tıkla</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {acceptedTypes
              .map((type) =>
                type
                  .replace('image/', '')
                  .replace('application/pdf', 'PDF')
                  .replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX')
                  .replace('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX')
                  .toUpperCase(),
              )
              .join(', ')} - Maks. {folder === 'documents' ? '20' : '10'} MB
            {showMaxFilesHint && hasFileLimit && maxFiles > 1 && ` - En fazla ${maxFiles} dosya`}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={acceptedTypes.join(',')}
            multiple={!hasFileLimit || maxFiles > 1}
            className="sr-only"
            aria-label={inputLabel}
            onChange={(event) => event.target.files && handleFiles(event.target.files)}
          />
        </div>
      )}

      {showPreviews && value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((asset) => (
            <div key={asset.id} className="group relative h-20 w-20">
              <img
                src={normalizeMediaDisplayUrl(asset.url)}
                alt={asset.originalName ?? 'Yüklenen görsel'}
                className="h-full w-full rounded-md border border-border object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeExisting(asset.id)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Görseli kaldır"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {activeUploads.length > 0 && (
        <div className="space-y-2">
          {activeUploads.map((upload) => (
            <div key={upload.id} className="flex items-center gap-3 text-sm">
              {upload.status === 'uploading' || upload.status === 'confirming' ? (
                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
              ) : (
                <ImageIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">{upload.file.name}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              </div>
              <span className="flex-shrink-0 text-xs text-muted-foreground">{upload.progress}%</span>
            </div>
          ))}
        </div>
      )}

      {errorUploads.length > 0 && (
        <div className="space-y-1">
          {errorUploads.map((upload) => (
            <div
              key={upload.id}
              className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="font-medium">{upload.file.name}: </span>
                <span>{upload.error}</span>
              </div>
              <button
                type="button"
                onClick={() => dismissError(upload.id)}
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
