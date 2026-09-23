'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { readApiData, readApiError } from '../../_components/api'
import type { RetryPreviewResult } from '../../_components/types'

interface RetryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  announcementId: string
  onRetryQueued: (requestedCount: number) => void
}

export function RetryDialog({ open, onOpenChange, announcementId, onRetryQueued }: RetryDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RetryPreviewResult | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) {
      setPreview(null)
      setReason('')
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    fetch(`/api/admin/announcements/${announcementId}/retry-preview`)
      .then(async (response) => {
        if (!response.ok) {
          setError(await readApiError(response, 'Yeniden deneme listesi alınamadı.'))
          return
        }
        setPreview(await readApiData<RetryPreviewResult>(response))
      })
      .catch(() => setError('Bağlantı hatası oluştu.'))
      .finally(() => setLoading(false))
  }, [open, announcementId])

  async function handleSubmit() {
    if (!preview) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await csrfFetch(`/api/admin/announcements/${announcementId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, eligibleHash: preview.eligibleHash }),
      })
      if (!response.ok) {
        setError(await readApiError(response, 'Yeniden deneme başlatılamadı.'))
        return
      }
      const data = await readApiData<{ requestedCount: number }>(response)
      onOpenChange(false)
      onRetryQueued(data.requestedCount)
    } catch {
      setError('Bağlantı hatası oluştu.')
    } finally {
      setSubmitting(false)
    }
  }

  const reasonValid = reason.trim().length >= 10 && reason.trim().length <= 500

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Başarısızları yeniden dene</DialogTitle>
          <DialogDescription>
            Sonucu belirsiz olanlar yeniden denenmez; sağlayıcı kaydı incelenmelidir.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Yükleniyor…
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        )}

        {preview && !loading && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                Yeniden denenecek: {preview.eligibleCount}
              </p>
              {preview.eligible.length > 0 && (
                <ul
                  className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2 text-sm"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  {preview.eligible.map((recipient) => (
                    <li key={recipient.id} className="flex items-center justify-between gap-3">
                      <span>{recipient.sellerName}</span>
                      <span className="font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {recipient.lastError ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              <p>Sonucu belirsiz: {preview.notEligible.uncertain}</p>
              <p>Hesabı silinmiş: {preview.notEligible.failedButSellerDeleted}</p>
              <p>Hâlâ işlemde: {preview.notEligible.stillInProgress}</p>
              <p>Toplam başarısız: {preview.notEligible.failedTotal}</p>
            </div>

            {preview.eligibleCount === 0 ? (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Yeniden denenecek başarısız alıcı yok.
              </p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="announcement-retry-reason">Yeniden deneme gerekçesi</Label>
                <Textarea
                  id="announcement-retry-reason"
                  rows={3}
                  minLength={10}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="En az 10, en fazla 500 karakter"
                />
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {reason.trim().length} / 500
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={!preview || preview.eligibleCount === 0 || !reasonValid}
            loading={submitting}
            onClick={() => void handleSubmit()}
          >
            Onayla ve kuyruğa al
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
