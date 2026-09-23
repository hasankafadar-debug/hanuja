'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { PRODUCT_QUESTION_MAX_LENGTH, productQuestionApiMessage } from './api-message'
import { ThreadReadReporter } from './thread-read-reporter'

export interface QuestionThreadMessage {
  id: string
  authorRole: 'customer' | 'seller' | 'admin'
  body: string
  createdAt: string
}

interface QuestionThreadProps {
  threadId: string
  sellerName: string
  messages: QuestionThreadMessage[]
  canReply: boolean
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

export function QuestionThread({ threadId, sellerName, messages, canReply }: QuestionThreadProps) {
  const router = useRouter()
  const lastRef = useRef<HTMLDivElement>(null)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastMessageId = messages[messages.length - 1]?.id ?? null

  useEffect(() => {
    lastRef.current?.scrollIntoView({ block: 'nearest' })
  }, [lastMessageId])

  async function handleReply(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (body.trim().length < 2) {
      setError('Lütfen mesajınızı yazın.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await csrfFetch(`/api/product-questions/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        setError(productQuestionApiMessage(payload, 'Mesajınız gönderilemedi.'))
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
      <ThreadReadReporter
        readUrl={`/api/product-questions/${threadId}/read`}
        lastMessageId={lastMessageId}
      />
      <ol className="space-y-3" aria-label="Mesajlar">
        {messages.map((message, index) => {
          const mine = message.authorRole === 'customer'
          return (
            <li key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                ref={index === messages.length - 1 ? lastRef : undefined}
                className={`flex max-w-[85%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}
              >
                <div
                  className="flex items-center gap-2 text-xs"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  <span className="font-medium">{mine ? 'Siz' : sellerName}</span>
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

      {canReply ? (
        <form
          onSubmit={handleReply}
          className="space-y-3 border-t pt-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <label htmlFor="question-reply" className="sr-only">
            Mesajınız
          </label>
          <textarea
            id="question-reply"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            maxLength={PRODUCT_QUESTION_MAX_LENGTH}
            disabled={submitting}
            placeholder="Mesajınızı yazın..."
            className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              {body.length} / {PRODUCT_QUESTION_MAX_LENGTH}
            </span>
            <Button type="submit" loading={submitting}>
              Gönder
            </Button>
          </div>
          {error ? (
            <p className="text-sm" role="alert" style={{ color: 'var(--color-destructive)' }}>
              {error}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Bu mağaza artık yanıt veremediği için konuşma salt okunur.
        </p>
      )}
    </div>
  )
}
