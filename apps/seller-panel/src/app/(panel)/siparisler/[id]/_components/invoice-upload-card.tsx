'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { Download, Eye, FileText, Upload } from 'lucide-react'

interface CurrentInvoice {
  fileName: string
  uploadedAt: string
}

interface Props {
  orderId: string
  currentInvoice: CurrentInvoice | null
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 20 * 1024 * 1024

export default function InvoiceUploadCard({ orderId, currentInvoice }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null
    setError(null)
    setSuccess(null)

    if (!nextFile) {
      setFile(null)
      return
    }

    if (!ALLOWED_TYPES.includes(nextFile.type)) {
      setError('Fatura PDF, JPEG, PNG veya WEBP formatında olmalıdır.')
      setFile(null)
      return
    }

    if (nextFile.size > MAX_SIZE) {
      setError('Dosya boyutu 20 MB limitini aşıyor.')
      setFile(null)
      return
    }

    setFile(nextFile)
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) {
      setError('Lütfen bir fatura dosyası seçin.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`/api/seller/orders/${orderId}/invoice`, {
        method: 'POST',
        body: formData,
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.message ?? 'Fatura yüklenemedi.')
      }

      setSuccess('Fatura kaydedildi.')
      setFile(null)
      if (inputRef.current) {
        inputRef.current.value = ''
      }
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Fatura yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-4 flex items-center gap-2">
        <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
        <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Satıcı Faturası
        </h2>
      </div>

      {currentInvoice ? (
        <div
          className="mb-4 rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            {currentInvoice.fileName}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            Son yükleme: {currentInvoice.uploadedAt}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={`/api/seller/orders/${orderId}/invoice`}>
                <Eye className="h-4 w-4" />
                Görüntüle
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/seller/orders/${orderId}/invoice?download=1`}>
                <Download className="h-4 w-4" />
                İndir
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div
          className="rounded-lg border-2 border-dashed px-4 py-6 text-center"
          style={{ borderColor: file ? 'var(--color-accent)' : 'var(--color-border)' }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            className="sr-only"
            onChange={handleFileChange}
          />
          <Upload className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--color-muted-fg)' }} />
          <p className="text-sm" style={{ color: 'var(--color-primary)' }}>
            {file ? file.name : 'Fatura seçmek için tıklayın'}
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            PDF önerilir, maksimum 20 MB.
          </p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-3 text-xs font-medium"
            style={{ color: 'var(--color-accent)' }}
          >
            Dosya Seç
          </button>
        </div>

        {error ? (
          <p className="text-xs rounded-lg border px-3 py-2" style={{ color: 'var(--color-destructive)', borderColor: 'var(--color-destructive)' }}>
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="text-xs rounded-lg border px-3 py-2" style={{ color: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
            {success}
          </p>
        ) : null}

        <Button type="submit" disabled={loading || !file}>
          {loading ? 'Yükleniyor…' : currentInvoice ? 'Faturayı Güncelle' : 'Fatura Yükle'}
        </Button>
      </form>
    </section>
  )
}
