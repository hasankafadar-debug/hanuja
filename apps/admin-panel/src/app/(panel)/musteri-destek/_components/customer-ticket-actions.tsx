'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Label, Textarea } from '@hanuja/ui'

interface CustomerTicketActionsProps {
  ticketId: string
  isResolved: boolean
}

export function CustomerTicketActions({ ticketId, isResolved }: CustomerTicketActionsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [replyBody, setReplyBody] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replySent, setReplySent] = useState(false)
  const [showResolveModal, setShowResolveModal] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolveError, setResolveError] = useState<string | null>(null)

  function handleReply(event: React.FormEvent) {
    event.preventDefault()
    if (!replyBody.trim()) return

    startTransition(async () => {
      setReplyError(null)
      setReplySent(false)

      const response = await fetch(
        `/api/admin/customer-support-tickets/${ticketId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: replyBody }),
        },
      )

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }

      if (!response.ok) {
        setReplyError(payload.message ?? payload.error ?? 'Yanıt gönderilemedi.')
        return
      }

      setReplyBody('')
      setReplySent(true)
      router.refresh()
    })
  }

  function handleResolveConfirm() {
    startTransition(async () => {
      setResolveError(null)

      const response = await fetch(
        `/api/admin/customer-support-tickets/${ticketId}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: resolutionNote.trim() || undefined }),
        },
      )

      const payload = (await response.json().catch(() => ({}))) as {
        message?: string
        error?: string
      }

      if (!response.ok) {
        setResolveError(payload.message ?? payload.error ?? 'Talep çözülemedi.')
        return
      }

      setShowResolveModal(false)
      router.refresh()
    })
  }

  if (isResolved) {
    return (
      <div
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>
          Bu talep çözümlendi.
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Müşteri yeni mesaj gönderirse talep yeniden açılır.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Yanıt formu */}
      <form
        onSubmit={handleReply}
        className="space-y-4 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            Müşteriye Yanıt Gönder
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Yanıt gönderilince talep durumu "Yanıt bekleniyor" olarak güncellenir.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="customer-ticket-reply">Mesaj</Label>
          <Textarea
            id="customer-ticket-reply"
            rows={5}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Müşteriye yazacağınız cevabı girin..."
            disabled={isPending}
            required
          />
        </div>

        {replyError && (
          <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {replyError}
          </p>
        )}
        {replySent && (
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>
            Yanıt gönderildi.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !replyBody.trim()}>
            {isPending ? 'Gönderiliyor...' : 'Yanıtı Gönder'}
          </Button>
        </div>
      </form>

      {/* Çözümleme aksiyonu */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ borderColor: 'var(--color-warning)', backgroundColor: '#fffbeb' }}
      >
        <div>
          <h2 className="text-base font-semibold" style={{ color: '#92400e' }}>
            Talebi Çözümlendi Olarak Kapat
          </h2>
          <p className="mt-0.5 text-sm" style={{ color: '#92400e' }}>
            Bu işlem talebi kapatır. Müşteri yeni mesaj gönderirse talep yeniden açılır.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => {
            setResolveError(null)
            setShowResolveModal(true)
          }}
        >
          Çözümlendi Olarak Kapat
        </Button>
      </div>

      {/* Çözümleme onay modali */}
      {showResolveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Talebi çözümle"
        >
          <div
            className="w-full max-w-md rounded-xl border p-6 space-y-4"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
              Talebi Çözümlendi Olarak Kapat
            </h3>
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              İsteğe bağlı bir çözüm notu ekleyebilirsiniz. Bu not admin tarafında kayıt olarak kalır.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="resolution-note">Çözüm Notu (isteğe bağlı)</Label>
              <Textarea
                id="resolution-note"
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Örn: Kargo firmasıyla görüşüldü, ürün teslim edildi."
                disabled={isPending}
              />
            </div>

            {resolveError && (
              <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
                {resolveError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => setShowResolveModal(false)}
              >
                İptal
              </Button>
              <Button
                type="button"
                disabled={isPending}
                onClick={handleResolveConfirm}
              >
                {isPending ? 'Kapatılıyor...' : 'Evet, Kapat'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
