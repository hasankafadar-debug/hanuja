'use client'

import { useRef, useState, useId } from 'react'
import { Button } from '@hanuja/ui'
import { Paperclip, X } from 'lucide-react'
import {
  uploadReturnPhoto,
  RETURN_ACCEPTED_MIME,
  RETURN_MAX_FILES,
  RETURN_MAX_FILE_MB,
} from './return-media-upload'

interface PickedFile {
  file: File
  state: 'uploading' | 'done' | 'error'
  assetId?: string
  error?: string
}

interface ReturnPhotoPickerProps {
  /** Called whenever the set of successfully-uploaded asset ids changes. */
  onChange: (assetIds: string[]) => void
  disabled?: boolean
  label?: string
}

export function ReturnPhotoPicker({ onChange, disabled, label }: ReturnPhotoPickerProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<PickedFile[]>([])
  const [error, setError] = useState<string | null>(null)

  function emit(next: PickedFile[]) {
    onChange(next.filter((f) => f.state === 'done' && f.assetId).map((f) => f.assetId as string))
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    setError(null)

    for (const file of picked) {
      if (files.length >= RETURN_MAX_FILES) {
        setError(`En fazla ${RETURN_MAX_FILES} görsel ekleyebilirsiniz.`)
        break
      }
      if (!RETURN_ACCEPTED_MIME.includes(file.type)) {
        setError('Yalnızca JPEG, PNG veya WebP görselleri kabul edilir.')
        continue
      }
      if (file.size > RETURN_MAX_FILE_MB * 1024 * 1024) {
        setError(`Her görsel en fazla ${RETURN_MAX_FILE_MB} MB olabilir.`)
        continue
      }

      const entry: PickedFile = { file, state: 'uploading' }
      setFiles((prev) => [...prev, entry])
      uploadReturnPhoto(file)
        .then((assetId) => {
          setFiles((prev) => {
            const next = prev.map((f) =>
              f.file === file ? { ...f, state: 'done' as const, assetId } : f,
            )
            emit(next)
            return next
          })
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Yükleme hatası'
          setFiles((prev) =>
            prev.map((f) => (f.file === file ? { ...f, state: 'error' as const, error: msg } : f)),
          )
        })
    }
  }

  function remove(index: number) {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== index)
      emit(next)
      return next
    })
  }

  return (
    <div>
      {label ? (
        <p className="mb-1.5 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          {label}
        </p>
      ) : null}
      {error ? (
        <p className="mb-2 text-xs" style={{ color: 'var(--color-destructive, #dc2626)' }}>
          {error}
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {files.map((f, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span
                className="truncate"
                style={{
                  color:
                    f.state === 'error'
                      ? 'var(--color-destructive, #dc2626)'
                      : 'var(--color-primary)',
                }}
              >
                {f.file.name}
                {f.state === 'uploading' && ' — yükleniyor...'}
                {f.state === 'error' && ` — ${f.error}`}
                {f.state === 'done' && ' — hazır'}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`${f.file.name} görselini kaldır`}
                className="shrink-0 rounded p-0.5"
              >
                <X className="h-3.5 w-3.5" style={{ color: 'var(--color-muted-fg)' }} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {files.length < RETURN_MAX_FILES ? (
        <>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={RETURN_ACCEPTED_MIME.join(',')}
            onChange={handleChange}
            disabled={disabled}
            className="sr-only"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
            Görsel Ekle
          </Button>
        </>
      ) : null}
    </div>
  )
}
