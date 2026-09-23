'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, startReadReceipt } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

const MAX_LENGTH = 2000

interface ThreadMessage {
  id: string
  authorRole: 'customer' | 'seller' | 'admin'
  body: string
  createdAt: string
}

interface SellerQuestionThreadProps {
  threadId: string
  customerName: string
  messages: ThreadMessage[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function apiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }
  return fallback
}

export function SellerQuestionThread({ threadId, customerName, messages }: SellerQuestionThreadProps) {
  const router = useRouter()
  const lastRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastMessageId = messages[messages.length - 1]?.id ?? null

  // Read receipt: only after the thread is mounted and the tab is visible. A
  // server render or link prefetch never clears the unread badge; the server
  // checks the message belongs to this seller's thread and never moves back.
  // Transient failures are retried a few times; a success is not repeated.
  useEffect(() => {
    lastRef.current?.scrollIntoView({ block: 'nearest' })
    if (!lastMessageId) return
    let receipt: ReturnType<typeof startReadReceipt> | null = null
    const frame = requestAnimationFrame(() => {
      receipt = startReadReceipt({
        send: () =>
          csrfFetch(`/api/seller/product-questions/${threadId}/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lastSeenMessageId: lastMessageId }),
          }),
        onAdvanced: () => router.refresh(),
        isVisible: () => document.visibilityState === 'visible',
        onVisibilityChange: (listener) => {
          document.addEventListener('visibilitychange', listener)
          return () => document.removeEventListener('visibilitychange', listener)
        },
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      receipt?.cancel()
    }
  }, [threadId, lastMessageId, router])

  async function handleReply(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (body.trim().length < 2) {
      setError('Lütfen yanıtınızı yazın.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await csrfFetch(`/api/seller/product-questions/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        setError(apiMessage(await res.json().catch(() => null), 'Yanıtınız gönderilemedi.'))
        return
      }
      setBody('')
      router.refresh()
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <ol className="space-y-3" aria-label="Mesajlar">
        {messages.map((message, index) => {
          const mine = message.authorRole === 'seller'
          return (
            <li key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                ref={index === messages.length - 1 ? lastRef : undefined}
                className={`flex max-w-[85%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  <span className="font-medium">{mine ? 'Siz' : customerName}</span>
                  <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                </div>
                <div
                  className="whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-sm"
                  style={{
                    backgroundColor: mine ? 'var(--color-muted)' : 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {message.body}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <form onSubmit={handleReply} className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
        <label htmlFor="seller-question-reply" className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Yanıtınız
        </label>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Telefon, e-posta, adres, IBAN veya bağlantı paylaşılamaz; konuşma platform içinde sürdürülür.
        </p>
        <textarea
          id="seller-question-reply"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={MAX_LENGTH}
          disabled={submitting}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            {body.length} / {MAX_LENGTH}
          </span>
          <Button type="submit" loading={submitting}>
            Yanıtı Gönder
          </Button>
        </div>
        {error ? (
          <p className="text-sm" role="alert" style={{ color: 'var(--color-destructive)' }}>
            {error}
          </p>
        ) : null}
      </form>
    </div>
  )
}
