"use client"

import * as React from 'react'
import { Download } from 'lucide-react'
import { Button } from '../button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../dialog'
import { LegalDocumentHtml } from './legal-document-html'

/**
 * Either the document itself, or a same-origin URL it is fetched from when the
 * dialog is first opened — lists with many documents use the URL so the HTML
 * is not shipped with every page load.
 */
type LegalDocumentSource =
  | { html: string; htmlUrl?: never }
  | { htmlUrl: string; html?: never }

type LegalDocumentDialogProps = LegalDocumentSource & {
  title: string
  description?: string
  triggerLabel: string
  disabled?: boolean
  triggerClassName?: string
  triggerVariant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
  downloadHref?: string
  downloadLabel?: string
}

export function LegalDocumentDialog({
  title,
  description,
  html,
  htmlUrl,
  triggerLabel,
  disabled = false,
  triggerClassName,
  triggerVariant = 'ghost',
  downloadHref,
  downloadLabel = 'İndir',
}: LegalDocumentDialogProps) {
  const [fetchedHtml, setFetchedHtml] = React.useState<string | null>(null)
  const [loadState, setLoadState] = React.useState<'idle' | 'loading' | 'error'>('idle')
  const documentHtml = html ?? fetchedHtml

  const loadDocument = React.useCallback(async () => {
    if (!htmlUrl) return
    setLoadState('loading')
    try {
      const res = await fetch(htmlUrl, { cache: 'no-store', credentials: 'same-origin' })
      // A redirect means the session ended and the route sent us to the login page;
      // never render that page inside the dialog.
      if (!res.ok || res.redirected) throw new Error(`Legal document request failed: ${res.status}`)
      setFetchedHtml(await res.text())
      setLoadState('idle')
    } catch {
      setLoadState('error')
    }
  }, [htmlUrl])

  function handleOpenChange(open: boolean) {
    if (open && htmlUrl && fetchedHtml === null && loadState !== 'loading') {
      void loadDocument()
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size="sm"
          className={triggerClassName}
          disabled={disabled}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden bg-white p-0 text-slate-900">
        <DialogHeader
          className="border-b bg-white px-6 py-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
            {downloadHref ? (
              <Button asChild type="button" variant="outline" size="sm">
                <a href={downloadHref}>
                  <Download className="h-4 w-4" />
                  {downloadLabel}
                </a>
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
          {documentHtml !== null ? (
            <LegalDocumentHtml html={documentHtml} />
          ) : loadState === 'error' ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm">Belge yüklenemedi.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadDocument()}>
                Tekrar dene
              </Button>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }} aria-live="polite">
              Belge yükleniyor…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
