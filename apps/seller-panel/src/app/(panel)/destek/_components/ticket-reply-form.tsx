'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FileUpload, Label, Textarea, type UploadedAsset } from '@hanuja/ui'

export function TicketReplyForm({
  ticketId,
  canReopen = false,
}: {
  ticketId: string
  canReopen?: boolean
}) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<UploadedAsset[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    startTransition(async () => {
      setError(null)
      setSaved(false)

      const response = await fetch(`/api/seller/support-tickets/${ticketId}/messages`, {
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

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
          Yanıt Gönder
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {canReopen
            ? 'Yeni mesaj gönderirseniz talep tekrar açık duruma alınır.'
            : 'Destek ekibine ek bilgi veya güncelleme paylaşabilirsiniz.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ticket-reply">Mesaj</Label>
        <Textarea
          id="ticket-reply"
          rows={5}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Yanıtınızı yazın"
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
  )
}
