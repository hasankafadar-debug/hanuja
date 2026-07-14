'use client'

/**
 * DocumentsForm — KYC belge yükleme ve durum görüntüleme.
 *
 * Upload flow:
 *  1. Kullanıcı belge türü seçer ve dosyayı seçer.
 *  2. POST /api/seller/documents → presigned URL alınır.
 *  3. Dosya doğrudan R2'ye PUT edilir.
 *  4. POST /api/seller/documents/[id]/confirm çağrılır.
 *  5. Liste yenilenir.
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
}

const TYPE_LABELS: Record<DocType, string> = {
  identity: 'Kimlik Belgesi (TC Kimlik / Pasaport)',
  tax_certificate: 'Vergi Levhası',
  trade_registry: 'Ticaret Sicil Gazetesi',
  signature_circular: 'İmza Sirküleri',
  bank_statement: 'Banka Hesap Cüzdanı / IBAN Belgesi',
  other: 'Diğer Belge',
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
}

export default function DocumentsForm({ initialDocuments }: Props) {
  const router = useRouter()
  const [documents, setDocuments] = useState<SellerDocument[]>(initialDocuments)
  const [selectedType, setSelectedType] = useState<DocType>('identity')
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  const MAX_SIZE = 20 * 1024 * 1024

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setFile(null); return }
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError('Yalnızca JPEG, PNG, WEBP veya PDF dosyaları kabul edilir.')
      setFile(null)
      return
    }
    if (f.size > MAX_SIZE) {
      setError('Dosya boyutu 20 MB limitini aşıyor.')
      setFile(null)
      return
    }
    setFile(f)
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) { setError('Lütfen bir dosya seçin.'); return }
    setUploading(true)
    setError(null)
    setSuccess(null)

    try {
      const initRes = await csrfFetch('/api/seller/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selectedType,
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      const initData = await initRes.json()
      if (!initRes.ok) throw new Error(initData.message ?? 'Yükleme başlatılamadı.')

      const { documentId, uploadUrl } = initData as { documentId: string; uploadUrl: string }
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': file.type }, body: file,
      })
      if (!uploadRes.ok) throw new Error('Dosya R2\'ye yüklenemedi. Lütfen tekrar deneyin.')

      const confirmRes = await csrfFetch(`/api/seller/documents/${documentId}/confirm`, { method: 'POST' })
      if (!confirmRes.ok) {
        const d = await confirmRes.json()
        throw new Error(d.message ?? 'Yükleme doğrulanamadı.')
      }

      setSuccess('Belge başarıyla yüklendi. Admin incelemesi bekleniyor.')
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''

      // Listeyi yenile
      startTransition(() => router.refresh())
      const listRes = await fetch('/api/seller/documents')
      if (listRes.ok) {
        const { documents: updated } = await listRes.json()
        setDocuments(updated)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bilinmeyen hata.')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm('Bu belgeyi silmek istediğinize emin misiniz?')) return
    setError(null)
    try {
      const res = await csrfFetch(`/api/seller/documents/${docId}`, { method: 'DELETE' })
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

  return (
    <div className="space-y-6">
      {/* Yükleme formu */}
      <div
        className="rounded-xl border p-5 space-y-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
          Yeni Belge Yükle
        </h3>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          JPEG, PNG, WEBP veya PDF — maksimum 20 MB. Belgeler admin incelemesinden sonra onaylanır.
        </p>

        <form onSubmit={handleUpload} className="space-y-4">
          {/* Belge türü */}
          <div>
            <label htmlFor="seller-document-type" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-primary)' }}>
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
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          {/* Dosya seçimi */}
          <div>
            <label htmlFor="seller-document-file" className="block text-xs font-medium mb-1" style={{ color: 'var(--color-primary)' }}>
              Dosya
            </label>
            <div
              className="relative flex items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 cursor-pointer transition-colors"
              style={{ borderColor: file ? 'var(--color-accent)' : 'var(--color-border)' }}
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
                <Upload className="mx-auto h-6 w-6 mb-2" style={{ color: 'var(--color-muted-fg)' }} />
                {file ? (
                  <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                    {file.name} <span style={{ color: 'var(--color-muted-fg)' }}>({formatBytes(file.size)})</span>
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
            <p className="text-xs rounded-lg border px-3 py-2" style={{ color: 'var(--color-destructive)', borderColor: 'var(--color-destructive)' }}>
              {error}
            </p>
          )}
          {success && (
            <p className="text-xs rounded-lg border px-3 py-2" style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
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
      </div>

      {/* Yüklenen belgeler listesi */}
      <div className="space-y-3">
        <h3 className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
          Yüklenen Belgeler ({documents.length})
        </h3>

        {documents.length === 0 ? (
          <div
            className="rounded-xl border px-5 py-8 text-center"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <FileText className="mx-auto h-8 w-8 mb-2" style={{ color: 'var(--color-muted-fg)' }} />
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz belge yüklenmedi.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => {
              const statusCfg = STATUS_CONFIG[doc.status]
              return (
                <div
                  key={doc.id}
                  className="rounded-xl border p-4 flex items-start gap-3"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                  }}
                >
                  <FileText className="h-5 w-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--color-muted-fg)' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {TYPE_LABELS[doc.type]}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>
                      {doc.fileName} · {formatBytes(doc.sizeBytes)} · {new Date(doc.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    {doc.adminNote && doc.status === 'rejected' && (
                      <p className="text-xs mt-1 rounded px-2 py-1" style={{ backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)', color: 'var(--color-destructive)' }}>
                        <span className="font-medium">Red gerekçesi:</span> {doc.adminNote}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1.5 hover:bg-black/5 transition-colors"
                      title="Belgeyi görüntüle"
                    >
                      <ExternalLink className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
                    </a>
                    {doc.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleDelete(doc.id)}
                        className="rounded p-1.5 hover:bg-red-50 transition-colors"
                        title="Belgeyi sil"
                      >
                        <Trash2 className="h-4 w-4" style={{ color: 'var(--color-destructive)' }} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
