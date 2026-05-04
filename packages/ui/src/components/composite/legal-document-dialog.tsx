"use client"

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

interface LegalDocumentDialogProps {
  title: string
  description?: string
  html: string
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
  triggerLabel,
  disabled = false,
  triggerClassName,
  triggerVariant = 'ghost',
  downloadHref,
  downloadLabel = 'İndir',
}: LegalDocumentDialogProps) {
  return (
    <Dialog>
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
          <LegalDocumentHtml html={html} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
