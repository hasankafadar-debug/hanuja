'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip } from 'lucide-react'
import { Button } from '@hanuja/ui'

type SerializedMessage = {
  id: string
  authorRole: 'customer' | 'admin' | 'seller'
  body: string
  createdAt: string
  attachments: Array<{
    id: string
    mediaAsset: {
      id: string
      url: string
      originalName: string | null
      mimeType: string | null
    }
  }>
}

interface TicketThreadClientProps {
  ticketId: string
  initialMessages: SerializedMessage[]
  isResolved: boolean
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TicketThreadClient({
  ticketId,
  initialMessages,
  isResolved,
}: TicketThreadClientProps) {
  const router = useRouter()
  const [replyBody, setReplyBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!replyBody.trim() || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch(`/api/support-tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyBody }),
      })

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        setError(data.message ?? 'Yanıt gönderilemedi.')
        return
      }

      setReplyBody('')
      router.refresh()
    } catch {
      setError('Bir hata oluştu. Lütfen tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Mesajlar */}
      <div className="space-y-3">
        {initialMessages.length === 0 && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz mesaj yok.
          </p>
        )}
        {initialMessages.map((msg) => {
          const isCustomer = msg.authorRole === 'customer'
          return (
            <div key={msg.id} className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${isCustomer ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--color-muted-fg)' }}>
                    {isCustomer ? 'Siz' : 'Destek Ekibi'}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(msg.createdAt)}
                  </span>
                </div>
                <div
                  className="rounded-xl px-4 py-3 text-sm whitespace-pre-wrap"
                  style={{
                    backgroundColor: isCustomer ? '#dbeafe' : 'var(--color-muted)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {msg.body}
                </div>
                {msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {msg.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.mediaAsset.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs rounded-md border px-2 py-1 hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-accent)' }}
                      >
                        <Paperclip className="h-3 w-3" />
                        {att.mediaAsset.originalName ?? 'Ek dosya'}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Yanıt formu */}
      {!isResolved && (
        <form onSubmit={handleReply} className="border-t pt-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Yanıtınızı buraya yazın..."
            rows={3}
            disabled={submitting}
            maxLength={4000}
            className="w-full rounded-lg border px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
            }}
          />
          {error && (
            <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={submitting || !replyBody.trim()}>
              {submitting ? 'Gönderiliyor...' : 'Yanıtla'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
