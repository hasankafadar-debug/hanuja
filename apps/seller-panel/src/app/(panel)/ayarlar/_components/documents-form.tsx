'use client'

/**
 * DocumentsForm — KYC belge yükleme ve durum görüntüleme.
 *
 * Upload flow:
 *  1. Kullanıcı belge türü seçer ve dosyayı seçer.
 *  2. POST /api/seller/documents → dosya FormData olarak uygulama API'sine gönderilir.
 *  3. API özel belge deposuna atomik olarak kaydeder ve bekleyen belge kaydını döner.
 */
import { useState, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle2, XCircle, Clock, Trash2, ExternalLink } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

type DocType =
  | 'identity'
  | 'tax_certificate'
  | 'trade_registry'
  | 'signature_circular'
  | 'bank_statement'
  | 'other'

type DocStatus = 'pending' | 'approved' | 'rejected'
type IdentityPart = 'combined' | 'front' | 'back'

interface SellerDocument {
  id: string
  type: DocType
  status: DocStatus
  fileName: string
  mimeType: string
  sizeBytes: number
  fileUrl: string
  adminNote: string | null
  createdAt: string
  identityPart?: IdentityPart | null
  requiresReupload?: boolean
  fileAvailable?: boolean
}

type UploadResponse = SellerDocument | { document: SellerDocument }

const TYPE_LABELS: Record<DocType, string> = {
  identity: 'Kimlik Belgesi (TC Kimlik / Pasaport)',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Cüzdanı / IBAN Belgesi',
  other: 'Diğer Belge',
}

const IDENTITY_PART_LABELS: Record<IdentityPart, string> = {
  combined: 'Tek dosya (ön ve arka birlikte)',
  front: 'Ön yüz',
  back: 'Arka yüz',
}

const STATUS_CONFIG: Record<DocStatus, { label: string; icon: React.ReactNode; color: string }> = {
  pending: {
    label: 'İnceleniyor',
    icon: <Clock className="h-4 w-4" />,
    color: 'var(--color-warning)',
  },
  approved: {
    label: 'Onaylandı',
    icon: <CheckCircle2 className="h-4 w-4" />,
    color: 'var(--color-success)',
  },
  rejected: {
    label: 'Reddedildi',
    icon: <XCircle className="h-4 w-4" />,
    color: 'var(--color-destructive)',
  },
}

interface Props {
  initialDocuments: SellerDocument[]
  /** When present, render the applicant-only, per-document upload workflow. */
  requestedTypes?: DocType[]
}

export default function DocumentsForm({ initialDocuments, requestedTypes }: Props) {
  const router = useRouter()
  const [documents, setDocuments] = useState<SellerDocument[]>(initialDocuments)
  const [selectedType, setSelectedType] = useState<DocType>('identity')
  const [selectedIdentityPart, setSelectedIdentityPart] = useState<IdentityPart>('combined')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadingType, setUploadingType] = useState<DocType | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  const MAX_SIZE = 20 * 1024 * 1024

  function validateFile(f: File): string | null {
    if (!ALLOWED_TYPES.includes(f.type))
      return 'Yalnızca JPEG, PNG, WEBP veya PDF dosyaları kabul edilir.'
    if (f.size > MAX_SIZE) return 'Dosya boyutu 20 MB limitini aşıyor.'
    return null
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) {
      setFile(null)
      return
    }
    const validationError = validateFile(f)
    if (validationError) {
      setError(validationError)
      setFile(null)
      return
    }
    setFile(f)
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) {
      setError('Lütfen bir dosya seçin.')
      return
    }
    await uploadDocument(selectedType, file, selectedIdentityPart)
  }

  async function uploadDocument(
    type: DocType,
    fileToUpload: File,
    identityPart: IdentityPart = 'combined',
  ) {
    setUploading(true)
    setUploadingType(type)
    setError(null)
    setSuccess(null)
    try {
      const formData = new FormData()
      formData.set('type', type)
      if (type === 'identity') formData.set('identityPart', identityPart)
      formData.set('file', fileToUpload)

      const uploadRes = await csrfFetch('/api/seller/documents', {
        method: 'POST',
        body: formData,
      })
      const uploadData = (await uploadRes.json().catch(() => null)) as
        | (UploadResponse & { message?: string })
        | null
      if (!uploadRes.ok) {
        throw new Error(uploadData?.message ?? 'Belge yüklenemedi. Lütfen tekrar deneyin.')
      }

      const document =
        uploadData && 'document' in uploadData
          ? uploadData.document
          : (uploadData as SellerDocument | null)
      if (!document?.id) {
        throw new Error('Belge kaydedilemedi. Lütfen tekrar deneyin.')
      }

      setDocuments((previous) => [
        ...previous.filter(
          (existing) =>
            existing.id !== document.id &&
            !(
              existing.type === document.type &&
              (document.type !== 'identity' || identityPartFor(existing) === identityPartFor(document)) &&
              requiresReupload(existing)
            ),
        ),
        document,
      ])

      setSuccess('Belge başarıyla yüklendi. Admin incelemesi bekleniyor.')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

      // Sunucu bileşenlerindeki başvuru durumunu yenile. Yerel liste, API yanıtıyla günceldir.
      startTransition(() => router.refresh())
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(
        message === 'Failed to fetch' || !message
          ? 'Belge yüklenirken bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.'
          : message,
      )
    } finally {
      setUploading(false)
      setUploadingType(null)
    }
  }

  async function handleRequestedFile(
    type: DocType,
    identityPart: IdentityPart,
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) return
    setError(null)
    const validationError = validateFile(selectedFile)
    if (validationError) {
      setError(validationError)
      return
    }
    await uploadDocument(type, selectedFile, identityPart)
  }

  async function handleDelete(docId: string) {
    if (!confirm('Bu belgeyi silmek istediğinize emin misiniz?')) return
    setError(null)
    try {
      const res = await csrfFetch(`/api/seller/documents/${docId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.message ?? 'Silme başarısız.')
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId))
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata.')
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  void isPending

  const isApplicationWorkflow = requestedTypes !== undefined
  const latestDocumentFor = (type: DocType) =>
    documents
      .filter((document) => document.type === type)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  const identityPartFor = (document: SellerDocument): IdentityPart => document.identityPart ?? 'combined'
  const latestDocumentForSlot = (type: DocType, identityPart: IdentityPart = 'combined') =>
    documents
      .filter(
        (document) =>
          document.type === type && (type !== 'identity' || identityPartFor(document) === identityPart),
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
  const requiresReupload = (document: SellerDocument) =>
    document.requiresReupload ??
    (document.fileUrl !== 'private://seller-document' &&
      !document.fileUrl.startsWith('/api/seller/documents/'))
  const identityMode = (() => {
    const identityDocuments = documents.filter((document) => document.type === 'identity')
    return identityDocuments.some((document) => identityPartFor(document) === 'combined')
      ? 'combined'
      : identityDocuments.length > 0
        ? 'separate'
        : null
  })()

  const renderRequestedSlot = (type: DocType, identityPart: IdentityPart = 'combined') => {
    const document = latestDocumentForSlot(type, identityPart)
    const status = document ? STATUS_CONFIG[document.status] : null
    const legacyDocumentRequiresReupload = document ? requiresReupload(document) : false
    const isBlockedByIdentityMode =
      type === 'identity' &&
      ((identityMode === 'combined' && identityPart !== 'combined') ||
        (identityMode === 'separate' && identityPart === 'combined'))
    const canUpload =
      !isBlockedByIdentityMode &&
      (!document || document.status === 'rejected' || legacyDocumentRequiresReupload)

    return (
      <div
        key={`${type}-${identityPart}`}
        className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
      >
        <FileText className="h-5 w-5 shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            {type === 'identity' ? IDENTITY_PART_LABELS[identityPart] : TYPE_LABELS[type]}
          </p>
          {isBlockedByIdentityMode ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              {identityMode === 'combined'
                ? 'Tek dosya kimlik yüklendiği için ön ve arka yüz ayrı eklenemez.'
                : 'Ön/arka yüz yüklemesi varken tek dosya eklenemez.'}
            </p>
          ) : document?.status === 'rejected' && document.adminNote ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-destructive)' }}>
              Red gerekçesi: {document.adminNote}
            </p>
          ) : legacyDocumentRequiresReupload ? (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-destructive)' }}>
              Bu eski belge güvenli depoya taşınmadı. Lütfen yeniden yükleyin.
            </p>
          ) : status ? (
            <p className="mt-1 text-xs" style={{ color: status.color }}>{status.label}</p>
          ) : (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>Belge bekleniyor</p>
          )}
        </div>
        {canUpload ? (
          <label
            className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-accent)',
              opacity: uploadingType && uploadingType !== type ? 0.55 : 1,
            }}
          >
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf"
              className="sr-only"
              disabled={uploadingType !== null}
              onChange={(event) => { void handleRequestedFile(type, identityPart, event) }}
            />
            {uploadingType === type ? 'Yükleniyor…' : document ? 'Yeniden yükle' : 'Belge yükle'}
          </label>
        ) : null}
        {document?.status === 'pending' ? (
          <button
            type="button"
            onClick={() => { void handleDelete(document.id) }}
            className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            Yüklemeyi sil
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Yükleme formu */}
      <div
        className="space-y-4 rounded-xl border p-5"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          {isApplicationWorkflow ? 'Talep edilen belgeler' : 'Yeni Belge Yükle'}
        </h3>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          JPEG, PNG, WEBP veya PDF — maksimum 20 MB. Belgeler admin incelemesinden sonra onaylanır.
        </p>

        {isApplicationWorkflow ? (
          requestedTypes.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Şu anda ek belge talebi bulunmuyor. İnceleme sonucu burada gösterilecektir.
            </p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {requestedTypes.map((type) => {
                if (type === 'identity') {
                  return (
                    <div key={type} className="py-4 first:pt-0 last:pb-0">
                      <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {TYPE_LABELS.identity}
                      </p>
                      {(['combined', 'front', 'back'] as IdentityPart[]).map((identityPart) =>
                        renderRequestedSlot(type, identityPart),
                      )}
                    </div>
                  )
                }
                const document = latestDocumentFor(type)
                const status = document ? STATUS_CONFIG[document.status] : null
                const legacyDocumentRequiresReupload = document ? requiresReupload(document) : false
                const canUpload =
                  !document || document.status === 'rejected' || legacyDocumentRequiresReupload
                return (
                  <div
                    key={type}
                    className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <FileText
                      className="h-5 w-5 shrink-0"
                      style={{ color: 'var(--color-muted-fg)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {TYPE_LABELS[type]}
                      </p>
                      {document?.status === 'rejected' && document.adminNote ? (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-destructive)' }}>
                          Red gerekçesi: {document.adminNote}
                        </p>
                      ) : null}
                      {legacyDocumentRequiresReupload ? (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-destructive)' }}>
                          Bu eski belge güvenli depoya taşınmadı. Lütfen yeniden yükleyin.
                        </p>
                      ) : null}
                      {status ? (
                        <p className="mt-1 text-xs" style={{ color: status.color }}>
                          {status.label}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          Belge bekleniyor
                        </p>
                      )}
                    </div>
                    {canUpload ? (
                      <label
                        className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
                        style={{
                          backgroundColor: 'var(--color-accent)',
                          opacity: uploadingType && uploadingType !== type ? 0.55 : 1,
                        }}
                      >
                        <input
                          type="file"
                          accept=".jpg,.jpeg,.png,.webp,.pdf"
                          className="sr-only"
                          disabled={uploadingType !== null}
                          onChange={(event) => {
                            void handleRequestedFile(type, 'combined', event)
                          }}
                        />
                        {uploadingType === type
                          ? 'Yükleniyor…'
                          : document
                            ? 'Yeniden yükle'
                            : 'Belge yükle'}
                      </label>
                    ) : null}
                    {document?.status === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleDelete(document.id)
                        }}
                        className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-neutral-50"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-primary)',
                        }}
                      >
                        Yüklemeyi sil
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )
        ) : (
          <form onSubmit={handleUpload} className="space-y-4">
            {/* Belge türü */}
            <div>
              <label
                htmlFor="seller-document-type"
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                Belge Türü
              </label>
              <select
                id="seller-document-type"
                aria-label="Belge türü"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as DocType)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
              >
                {(Object.entries(TYPE_LABELS) as [DocType, string][]).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {selectedType === 'identity' ? (
              <fieldset>
                <legend className="mb-1 block text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                  Kimlik bölümü
                </legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.entries(IDENTITY_PART_LABELS) as [IdentityPart, string][]).map(([value, label]) => (
                    <label
                      key={value}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs"
                      style={{ borderColor: selectedIdentityPart === value ? 'var(--color-accent)' : 'var(--color-border)' }}
                    >
                      <input
                        type="radio"
                        name="seller-document-identity-part"
                        value={value}
                        checked={selectedIdentityPart === value}
                        onChange={() => setSelectedIdentityPart(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {/* Dosya seçimi */}
            <div>
              <label
                htmlFor="seller-document-file"
                className="mb-1 block text-xs font-medium"
                style={{ color: 'var(--color-primary)' }}
              >
                Dosya
              </label>
              <div
                className="relative flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 transition-colors"
                style={{
                  borderColor: file ? 'var(--color-accent)' : 'var(--color-border)',
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  id="seller-document-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  className="sr-only"
                  aria-label="Belge dosyası"
                  onChange={handleFileChange}
                />
                <div className="text-center">
                  <Upload
                    className="mx-auto mb-2 h-6 w-6"
                    style={{ color: 'var(--color-muted-fg)' }}
                  />
                  {file ? (
                    <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {file.name}{' '}
                      <span style={{ color: 'var(--color-muted-fg)' }}>
                        ({formatBytes(file.size)})
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      Dosya seçmek için tıklayın
                    </p>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <p
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  color: 'var(--color-destructive)',
                  borderColor: 'var(--color-destructive)',
                }}
              >
                {error}
              </p>
            )}
            {success && (
              <p
                className="rounded-lg border px-3 py-2 text-xs"
                style={{
                  color: 'var(--color-success)',
                  borderColor: 'var(--color-success)',
                }}
              >
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={uploading || !file}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)', color: '#fff' }}
            >
              {uploading ? 'Yükleniyor…' : 'Belgeyi Yükle'}
            </button>
          </form>
        )}

        {isApplicationWorkflow && error ? (
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
        {isApplicationWorkflow && success ? (
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
      </div>

      {/* Yüklenen belgeler listesi */}
      {!isApplicationWorkflow && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            Yüklenen Belgeler ({documents.length})
          </h3>

          {documents.length === 0 ? (
            <div
              className="rounded-xl border px-5 py-8 text-center"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <FileText
                className="mx-auto mb-2 h-8 w-8"
                style={{ color: 'var(--color-muted-fg)' }}
              />
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Henüz belge yüklenmedi.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => {
                const legacyDocumentRequiresReupload = requiresReupload(doc)
                const statusCfg = legacyDocumentRequiresReupload
                  ? STATUS_CONFIG.rejected
                  : STATUS_CONFIG[doc.status]
                return (
                  <div
                    key={doc.id}
                    className="flex items-start gap-3 rounded-xl border p-4"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: 'var(--color-surface)',
                    }}
                  >
                    <FileText
                      className="mt-0.5 h-5 w-5 flex-shrink-0"
                      style={{ color: 'var(--color-muted-fg)' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {TYPE_LABELS[doc.type]}
                        {doc.type === 'identity' ? ` — ${IDENTITY_PART_LABELS[identityPartFor(doc)]}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {doc.fileName} · {formatBytes(doc.sizeBytes)} ·{' '}
                        {new Date(doc.createdAt).toLocaleDateString('tr-TR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                      {doc.adminNote && doc.status === 'rejected' && (
                        <p
                          className="mt-1 rounded px-2 py-1 text-xs"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
                            color: 'var(--color-destructive)',
                          }}
                        >
                          <span className="font-medium">Red gerekçesi:</span> {doc.adminNote}
                        </p>
                      )}
                      {legacyDocumentRequiresReupload && (
                        <p
                          className="mt-1 rounded px-2 py-1 text-xs"
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
                            color: 'var(--color-destructive)',
                          }}
                        >
                          Bu eski belge güvenli depoya taşınmadı. Lütfen yeniden yükleyin.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${statusCfg.color} 15%, transparent)`,
                          color: statusCfg.color,
                        }}
                      >
                        {statusCfg.icon}
                        {statusCfg.label}
                      </span>
                      {!legacyDocumentRequiresReupload && (
                        <a
                          href={`/api/seller/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1.5 transition-colors hover:bg-black/5"
                          title="Belgeyi görüntüle"
                        >
                          <ExternalLink
                            className="h-4 w-4"
                            style={{ color: 'var(--color-muted-fg)' }}
                          />
                        </a>
                      )}
                      {doc.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => handleDelete(doc.id)}
                          className="rounded p-1.5 transition-colors hover:bg-red-50"
                          title="Belgeyi sil"
                        >
                          <Trash2
                            className="h-4 w-4"
                            style={{ color: 'var(--color-destructive)' }}
                          />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
