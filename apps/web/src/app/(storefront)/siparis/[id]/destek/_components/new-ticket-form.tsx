'use client'

import { useState, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { Paperclip, X, AlertCircle } from 'lucide-react'

type Category =
  | 'shipping_delay'
  | 'damaged_product'
  | 'wrong_product'
  | 'invoice_issue'
  | 'payment_issue'
  | 'return_or_exchange'
  | 'other'

const CATEGORY_LABELS: Record<Category, string> = {
  shipping_delay: 'Kargo gecikmesi',
  damaged_product: 'Ürün hasarlı / hatalı',
  wrong_product: 'Yanlış ürün geldi',
  invoice_issue: 'Fatura sorunu',
  payment_issue: 'Ödeme sorunu',
  return_or_exchange: 'İade & Değişim',
  other: 'Diğer',
}

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_FILES = 5
const MAX_FILE_SIZE_MB = 20

interface AttachedFile {
  file: File
  state: 'pending' | 'uploading' | 'done' | 'error'
  assetId?: string
  error?: string
}

interface NewTicketFormProps {
  orderId: string
}

interface ApiEnvelope<T> {
  data: T
  success: boolean
}

export function NewTicketForm({ orderId }: NewTicketFormProps) {
  const router = useRouter()
  const fileInputId = useId()

  const [category, setCategory] = useState<Category | ''>('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<AttachedFile[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

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
        setFormError(`En fazla ${MAX_FILES} dosya ekleyebilirsiniz.`)
        break
      }
      if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
        setFormError('Yalnızca JPEG, PNG, WebP ve PDF dosyaları kabul edilir.')
        continue
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setFormError(`Her dosya en fazla ${MAX_FILE_SIZE_MB} MB olabilir.`)
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
    setFormError(null)

    if (!category) return setFormError('Lütfen bir kategori seçin.')
    if (!subject.trim()) return setFormError('Lütfen konu başlığı girin.')
    if (!body.trim()) return setFormError('Lütfen açıklama girin.')

    const uploading = attachments.some((a) => a.state === 'uploading')
    if (uploading) return setFormError('Dosyalar henüz yükleniyor. Lütfen bekleyin.')

    const failedUploads = attachments.filter((a) => a.state === 'error')
    if (failedUploads.length > 0) return setFormError('Bazı dosyalar yüklenemedi. Lütfen kaldırın veya tekrar deneyin.')

    const attachmentAssetIds = attachments
      .filter((a) => a.state === 'done' && a.assetId)
      .map((a) => a.assetId as string)

    setSubmitting(true)
    try {
      const res = await fetch(`/api/orders/${orderId}/support-tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subject: subject.trim(), body: body.trim(), attachmentAssetIds }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { message?: string }).message ?? 'Destek talebi oluşturulamadı.')
      }

      const created = (await res.json()) as ApiEnvelope<{ id?: string }>
      const ticketId = created.data?.id
      if (!ticketId) {
        throw new Error('Destek talebi oluşturuldu ama detay sayfası açılamadı.')
      }
      router.push(`/siparis/${orderId}/destek/${ticketId}`)
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Bir hata oluştu.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {formError && (
        <div
          className="flex items-start gap-2 rounded-lg border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--color-destructive, #dc2626)',
            color: 'var(--color-destructive, #dc2626)',
            backgroundColor: 'var(--color-destructive-muted, #fef2f2)',
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div>
        <label
          htmlFor="category"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Kategori <span aria-hidden="true">*</span>
        </label>
        <select
          id="category"
          required
          value={category}
          onChange={(e) => setCategory(e.target.value as Category)}
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        >
          <option value="">Seçin...</option>
          {(Object.entries(CATEGORY_LABELS) as [Category, string][]).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="subject"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Konu <span aria-hidden="true">*</span>
        </label>
        <input
          id="subject"
          type="text"
          required
          maxLength={120}
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Sorununuzu kısaca özetleyin"
          className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <p className="mt-1 text-right text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {subject.length}/120
        </p>
      </div>

      <div>
        <label
          htmlFor="body"
          className="mb-1.5 block text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Açıklama <span aria-hidden="true">*</span>
        </label>
        <textarea
          id="body"
          required
          maxLength={4000}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Sorununuzu ayrıntılı açıklayın..."
          className="w-full resize-y rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <p className="mt-1 text-right text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {body.length}/4000
        </p>
      </div>

      <div>
        <p
          className="mb-1.5 text-sm font-medium"
          style={{ color: 'var(--color-primary)' }}
        >
          Ekler (isteğe bağlı)
        </p>
        <p className="mb-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          JPEG, PNG, WebP veya PDF — en fazla {MAX_FILES} dosya, her biri {MAX_FILE_SIZE_MB} MB altında
        </p>

        {attachments.length > 0 && (
          <ul className="mb-3 space-y-1">
            {attachments.map((attachment, index) => (
              <li
                key={index}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
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
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              Dosya Ekle
            </Button>
          </>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" loading={submitting} disabled={submitting}>
          Destek Talebi Gönder
        </Button>
      </div>
    </form>
  )
}
