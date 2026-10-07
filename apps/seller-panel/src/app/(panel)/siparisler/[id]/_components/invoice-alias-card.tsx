'use client'

import { useState } from 'react'
import { Button } from '@hanuja/ui'
import { Clipboard } from 'lucide-react'

interface Props {
  aliasEmail: string | null
  status: 'ready' | 'disabled' | 'error'
}

export default function InvoiceAliasCard({ aliasEmail, status }: Props) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)

  async function copyAlias() {
    if (!aliasEmail) return
    try {
      await navigator.clipboard.writeText(aliasEmail)
      setCopyError(false)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopyError(true)
    }
  }

  return (
    <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          Fatura e-posta adresi
        </h3>

      {aliasEmail ? (
        <div className="flex flex-col items-start gap-3">
          <code
            className="w-full min-w-0 break-all rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            {aliasEmail}
          </code>
          <Button type="button" variant="outline" onClick={copyAlias}>
            <Clipboard className="h-4 w-4" />
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </Button>
        </div>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {status === 'disabled'
            ? 'Otomatik fatura alımı şu anda kapalı. Faturayı manuel yükleyebilirsiniz.'
            : 'Fatura e-posta adresi şu anda oluşturulamadı. Sayfayı yenileyerek tekrar deneyin veya faturayı manuel yükleyin.'}
        </p>
      )}
      {aliasEmail ? <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        PDF faturayı bu adrese gönderin. Fatura otomatik olarak bu siparişe eklenecektir.
      </p> : null}
      {copyError ? <p role="alert" className="text-xs">Adres kopyalanamadı. Yukarıdaki adresi seçerek kopyalayabilirsiniz.</p> : null}
      <span role="status" className="sr-only">{copied ? 'Fatura e-posta adresi kopyalandı' : ''}</span>
    </div>
  )
}
