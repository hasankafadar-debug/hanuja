'use client'

import { useState, useRef, useId } from 'react'
import { Button } from '@hanuja/ui'
import { Paperclip, X, AlertCircle, Send } from 'lucide-react'

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILES = 5
const MAX_FILE_SIZE_MB = 20

interface AttachedFile {
  file: File
  state: 'pending' | 'uploading' | 'done' | 'error'
  assetId?: string
  error?: string
}

interface ReplyFormProps {
  ticketId: string
  onReplySent: () => void
}

export function ReplyForm({ ticketId, onReplySent }: ReplyFormProps) {
  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function uploadFile(file: File): Promise<string> {
    const urlRes = await fetch('/api/support-tickets/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: file.type, originalName: file.name }),
    })
    if (!urlRes.ok) throw new Error('Yükleme URL alınamadı.')
    const { uploadUrl, key } = await urlRes.json()
    const putRes = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } })
    if (!putRes.ok) throw new Error('Dosya yüklenemedi.')
    const confirmRes = await fetch(`/api/support-tickets/media/${key}/confirm`, { method: 'POST' })
    if (!confirmRes.ok) throw new Error('Dosya doğrulanamadı.')
    const { id: assetId } = await confirmRes.json()
    return assetId
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''

    for (const file of files) {
      if (attachments.length >= MAX_FILES) {
        setError(`En fazla ${MAX_FILES} dosya ekleyebilirsiniz.`)
        break
      }
      if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
        setError('Yalnızca JPEG, PNG, WebP ve PDF dosyaları kabul edilir.')
        continue
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`Her dosya en fazla ${MAX_FILE_SIZE_MB} MB olabilir.`)
        continue
      }

      const entry: AttachedFile = { file, state: 'uploading' }
      setAttachments((prev) => [...prev, entry])

      uploadFile(file)
        .then((assetId) => {
          setAttachments((prev) =>
            prev.map((a) => (a.file === file ? { ...a, state: 'done', assetId } : a)),
          )
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Yükleme hatası'
          setAttachments((prev) =>
            prev.map((a) => (a.file === file ? { ...a, state: 'error', error: msg } : a)),
          )
        })
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!body.trim()) return setError('Lütfen yanıtınızı yazın.')

    const uploading = attachments.some((a) => a.state === 'uploading')
    if (uploading) return setError('Dosyalar henüz yükleniyor. Lütfen bekleyin.')

    const failedUploads = attachments.filter((a) => a.state === 'error')
    if (failedUploads.length > 0) return setError('Bazı dosyalar yüklenemedi. Lütfen kaldırın.')

    const attachmentAssetIds = attachments
      .filter((a) => a.state === 'done' && a.assetId)
      .map((a) => a.assetId as string)

    setSubmitting(true)
    try {
      const res = await fetch(`/api/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim(), attachmentAssetIds }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? 'Yanıt gönderilemedi.')
      }

      setBody('')
      setAttachments([])
      onReplySent()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div
          className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          style={{
            borderColor: 'var(--color-destructive, #dc2626)',
            color: 'var(--color-destructive, #dc2626)',
            backgroundColor: 'var(--color-destructive-muted, #fef2f2)',
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <textarea
        required
        maxLength={4000}
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Yanıtınızı yazın..."
        className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-primary)',
        }}
      />

      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map((attachment, index) => (
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span
                className="truncate"
                style={{
                  color:
                    attachment.state === 'error'
                      ? 'var(--color-destructive, #dc2626)'
                      : 'var(--color-primary)',
                }}
              >
                {attachment.file.name}
                {attachment.state === 'uploading' && ' — yükleniyor...'}
                {attachment.state === 'error' && ` — ${attachment.error}`}
                {attachment.state === 'done' && ' — hazır'}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(index)}
                aria-label={`${attachment.file.name} ekini kaldır`}
                className="shrink-0 rounded p-0.5 hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" style={{ color: 'var(--color-muted-fg)' }} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          {attachments.length < MAX_FILES && (
            <>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                multiple
                accept={ACCEPTED_MIME_TYPES.join(',')}
                onChange={handleFileChange}
                className="sr-only"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-4 w-4" />
                Dosya Ekle
              </Button>
            </>
          )}
        </div>
        <Button type="submit" size="sm" loading={submitting} disabled={submitting}>
          <Send className="h-4 w-4" />
          Gönder
        </Button>
      </div>
    </form>
  )
}
