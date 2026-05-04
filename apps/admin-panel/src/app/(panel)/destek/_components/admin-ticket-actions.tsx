'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FileUpload, Label, Textarea, type UploadedAsset } from '@hanuja/ui'

export function AdminTicketActions({
  ticketId,
  isResolved,
}: {
  ticketId: string
  isResolved: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<UploadedAsset[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleReply(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      setError(null)
      setSaved(false)

      const response = await fetch(`/api/admin/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, attachmentAssetIds: attachments.map((asset) => asset.id) }),
      })

      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!response.ok) {
        setError(payload.message ?? payload.error ?? 'Yanıt gönderilemedi.')
        return
      }

      setBody('')
      setAttachments([])
      setSaved(true)
      router.refresh()
    })
  }

  function handleResolve() {
    startTransition(async () => {
      setError(null)
      setSaved(false)

      const response = await fetch(`/api/admin/support-tickets/${ticketId}/resolve`, {
        method: 'POST',
      })

      const payload = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
      if (!response.ok) {
        setError(payload.message ?? payload.error ?? 'Talep çözülemedi.')
        return
      }

      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleReply}
        className="space-y-4 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="space-y-1">
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            Satıcıya Yanıt Gönder
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Gönderilen yanıt satıcı panelindeki bildirim zilinde yeni uyarı olarak görünecek.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="admin-ticket-reply">Mesaj</Label>
          <Textarea
            id="admin-ticket-reply"
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Satıcıya yazacağınız cevabı girin"
            disabled={isPending}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label>Dosya Eki</Label>
          <FileUpload
            folder="documents"
            maxFiles={5}
            value={attachments}
            onChange={setAttachments}
            disabled={isPending}
            showPreviews={false}
            inputLabel="Destek dosyası yükle"
          />
        </div>

        {error && (
          <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm" style={{ color: 'var(--color-success)' }}>
            Yanıt gönderildi.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Gönderiliyor...' : 'Yanıtı Gönder'}
          </Button>
        </div>
      </form>

      {!isResolved && (
        <div
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-warning)', backgroundColor: '#fffbeb' }}
        >
          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold" style={{ color: '#92400e' }}>
                Talebi Çözüldü Olarak İşaretle
              </h2>
              <p className="text-sm" style={{ color: '#92400e' }}>
                Bu işlem talebi kapatır. Satıcı yeni bir mesaj gönderirse talep yeniden açılır.
              </p>
            </div>
            <Button type="button" variant="outline" disabled={isPending} onClick={handleResolve}>
              Çözüldü Olarak İşaretle
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
