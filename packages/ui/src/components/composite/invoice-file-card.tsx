'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Download, Eye, Trash2, Upload } from 'lucide-react'
import { Button } from '../button'
import { ConfirmDialog } from './confirm-dialog'

export interface ManagedInvoiceFile {
  fileName: string
  uploadedAt: string
  revision: string
}

export interface InvoiceFileCardProps {
  endpoint: string
  invoice: ManagedInvoiceFile | null
  request: (url: string, init?: RequestInit) => Promise<Response>
  onChanged: () => void
  canEdit: boolean
  allowUpload?: boolean
  allowDelete?: boolean
  firstUploadedAt?: string | null
  sellerEditDeadline?: string | null
}

const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]
const MAX_SIZE = 20 * 1024 * 1024

function formatDate(value: string) {
  return new Date(value).toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function InvoiceFileCard({
  endpoint,
  invoice,
  request,
  onChanged,
  canEdit,
  allowUpload = true,
  allowDelete = true,
  firstUploadedAt,
  sellerEditDeadline,
}: InvoiceFileCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const [file, setFile] = useState<File | null>(null)
  const [replacementReason, setReplacementReason] = useState('')
  const [deleteReason, setDeleteReason] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const deadline = sellerEditDeadline
    ? new Date(sellerEditDeadline).getTime()
    : null
  const editable = canEdit && (deadline === null || now < deadline)

  useEffect(() => {
    if (deadline === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadline])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setError(null)
    setSuccess(null)
    setFile(null)
    if (!nextFile) return
    if (!ALLOWED_TYPES.includes(nextFile.type)) {
      setError('Fatura PDF, JPEG, PNG veya WEBP formatında olmalıdır.')
      event.target.value = ''
      return
    }
    if (nextFile.size > MAX_SIZE) {
      setError('Dosya boyutu 20 MB limitini aşıyor.')
      event.target.value = ''
      return
    }
    setFile(nextFile)
  }

  async function checkResponse(response: Response, fallback: string) {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if ([403, 412, 428].includes(response.status)) {
        setConfirmOpen(false)
        setDeleteReason('')
        setReplacementReason('')
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        onChanged()
      }
      throw new Error(payload.message ?? fallback)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading || !editable || !allowUpload) return
    if (!file) {
      setError('Lütfen bir fatura dosyası seçin.')
      return
    }
    if (invoice && replacementReason.trim().length < 5) {
      setError('Değiştirme gerekçesi en az 5 karakter olmalıdır.')
      return
    }
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const body = new FormData()
      body.append('file', file)
      if (invoice) body.append('reason', replacementReason.trim())
      const response = await request(endpoint, {
        method: 'POST',
        body,
        ...(invoice
          ? { headers: { 'If-Match': `"${invoice.revision}"` } }
          : {}),
      })
      await checkResponse(response, 'Fatura yüklenemedi.')
      setSuccess('Fatura kaydedildi.')
      setFile(null)
      setReplacementReason('')
      if (inputRef.current) inputRef.current.value = ''
      onChanged()
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Fatura yüklenemedi.',
      )
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (
      loading ||
      !editable ||
      !allowDelete ||
      !invoice ||
      deleteReason.trim().length < 5
    )
      return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await request(endpoint, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${invoice.revision}"`,
        },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      })
      await checkResponse(response, 'Fatura silinemedi.')
      setSuccess('Siparişe eklenen fatura dosyası kaldırıldı.')
      setConfirmOpen(false)
      setDeleteReason('')
      setFile(null)
      setReplacementReason('')
      if (inputRef.current) inputRef.current.value = ''
      onChanged()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Fatura silinemedi.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {invoice ? (
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p
            className="break-all text-sm font-medium"
            style={{ color: 'var(--color-primary)' }}
          >
            {invoice.fileName}
          </p>
          <p
            className="mt-1 text-xs"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            Son işlem: {formatDate(invoice.uploadedAt)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={endpoint}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                Görüntüle
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`${endpoint}?download=1`}>
                <Download className="h-4 w-4" aria-hidden="true" />
                İndir
              </a>
            </Button>
            {allowDelete ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={loading || !editable}
                onClick={() => {
                  setError(null)
                  setConfirmOpen(true)
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Faturayı Sil
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Satıcı faturası henüz yüklenmedi.
        </p>
      )}

      {firstUploadedAt ? (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          İlk fatura yükleme: {formatDate(firstUploadedAt)}
        </p>
      ) : null}
      {sellerEditDeadline ? (
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Düzeltme için son tarih: {formatDate(sellerEditDeadline)}
        </p>
      ) : null}
      {!editable && sellerEditDeadline ? (
        <p
          role="status"
          className="rounded-lg border px-3 py-2 text-sm"
          style={{
            color: 'var(--color-muted-fg)',
            borderColor: 'var(--color-border)',
          }}
        >
          30 günlük düzeltme süresi doldu. Değişiklik için Hanuja yönetimiyle
          iletişime geçin.
        </p>
      ) : null}

      {allowUpload ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div
            className="rounded-lg border-2 border-dashed px-4 py-6 text-center"
            style={{
              borderColor: file ? 'var(--color-accent)' : 'var(--color-border)',
            }}
          >
            <input
              id={`${id}-file`}
              ref={inputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="sr-only"
              aria-label="Fatura dosyası"
              disabled={loading || !editable}
              onChange={handleFileChange}
            />
            <Upload
              className="mx-auto mb-2 h-6 w-6"
              aria-hidden="true"
              style={{ color: 'var(--color-muted-fg)' }}
            />
            <p
              className="break-all text-sm"
              style={{ color: 'var(--color-primary)' }}
            >
              {file ? file.name : 'Fatura dosyası seçin'}
            </p>
            <p
              className="mt-1 text-xs"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              PDF önerilir, maksimum 20 MB.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={loading || !editable}
              onClick={() => inputRef.current?.click()}
            >
              Dosya Seç
            </Button>
          </div>
          {invoice ? (
            <div className="space-y-1">
              <label htmlFor={`${id}-replace-reason`} className="block text-sm">
                Değiştirme gerekçesi
              </label>
              <textarea
                id={`${id}-replace-reason`}
                rows={2}
                minLength={5}
                maxLength={1000}
                required
                disabled={loading || !editable}
                value={replacementReason}
                onChange={(event) => setReplacementReason(event.target.value)}
                className="w-full rounded-lg border p-2 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                }}
              />
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                En az 5 karakter. Yeni dosya mevcut faturanın yerini alır.
              </p>
            </div>
          ) : null}
          <Button
            type="submit"
            loading={loading}
            disabled={
              !editable ||
              !file ||
              (invoice !== null && replacementReason.trim().length < 5)
            }
          >
            {invoice ? 'Faturayı Güncelle' : 'Fatura Yükle'}
          </Button>
        </form>
      ) : null}
      {error && !confirmOpen ? (
        <p
          role="alert"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            color: 'var(--color-destructive)',
            borderColor: 'var(--color-destructive)',
          }}
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            color: 'var(--color-success)',
            borderColor: 'var(--color-success)',
          }}
        >
          {success}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!loading) setConfirmOpen(open)
        }}
        title="Faturayı sil"
        description="Siparişe eklenen fatura dosyası kaldırılacak. Bu işlem muhasebe veya e-fatura iptali yapmaz. Müşteriye silme bildirimi gönderilmez."
        confirmLabel="Faturayı Sil"
        loading={loading}
        confirmDisabled={!editable || deleteReason.trim().length < 5}
        onConfirm={handleDelete}
      >
        <div className="space-y-2">
          <label
            htmlFor={`${id}-delete-reason`}
            className="block text-sm font-medium"
          >
            Silme gerekçesi
          </label>
          <textarea
            id={`${id}-delete-reason`}
            rows={3}
            minLength={5}
            maxLength={1000}
            disabled={loading}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            className="w-full rounded-lg border p-2 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          />
          <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            En az 5 karakter.
          </p>
          {error ? (
            <p
              role="alert"
              className="text-xs"
              style={{ color: 'var(--color-destructive)' }}
            >
              {error}
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  )
}
