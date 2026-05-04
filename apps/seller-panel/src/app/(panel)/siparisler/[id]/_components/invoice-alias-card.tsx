'use client'

import { useState } from 'react'
import { Button } from '@hanuja/ui'
import { Clipboard, MailCheck } from 'lucide-react'

interface Props {
  aliasEmail: string | null
}

export default function InvoiceAliasCard({ aliasEmail }: Props) {
  const [copied, setCopied] = useState(false)

  async function copyAlias() {
    if (!aliasEmail) return
    await navigator.clipboard.writeText(aliasEmail)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="mb-4 flex items-center gap-2">
        <MailCheck className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
        <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Fatura e-posta adresi
        </h2>
      </div>

      {aliasEmail ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <code
            className="min-w-0 flex-1 break-all rounded-lg border px-3 py-2 text-sm"
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
          Fatura e-posta adresi bu sipariş için henüz hazır değil.
        </p>
      )}
    </section>
  )
}
