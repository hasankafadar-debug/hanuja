'use client'

import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@hanuja/ui'

interface SendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipientCount: number
  loading: boolean
  error: string | null
  onConfirm: () => void
}

export function SendDialog({ open, onOpenChange, recipientCount, loading, error, onConfirm }: SendDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Duyuruyu gönder</DialogTitle>
          <DialogDescription className="pt-2">
            {recipientCount} satıcıya ayrı e-posta gidecek; gönderim geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Resend günlük kotası işlemsel e-postalarla ortaktır; büyük bir gönderim o gün sipariş ve şifre
          e-postalarını da etkileyebilir.
        </p>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button type="button" variant="default" loading={loading} onClick={onConfirm}>
            Gönder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
