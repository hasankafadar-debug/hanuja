'use client'

import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@hanuja/ui'
import LegalDocumentHtml from './legal-document-html'

interface LegalDocumentDialogProps {
  title: string
  description?: string
  html: string
  triggerLabel: string
  disabled?: boolean
  triggerClassName?: string
  triggerVariant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive'
}

export default function LegalDocumentDialog({
  title,
  description,
  html,
  triggerLabel,
  disabled = false,
  triggerClassName,
  triggerVariant = 'ghost',
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
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-6 py-5">
          <LegalDocumentHtml html={html} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
