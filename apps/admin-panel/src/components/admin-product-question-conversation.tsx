'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Textarea } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

interface Message {
  id: string
  authorRole: string
  audience: string | null
  body: string
  createdAt: string
}

const ROLE_LABELS: Record<string, string> = {
  customer: 'Müşteri',
  seller: 'Tasarımcı',
  admin: 'Admin',
}
const CHANNEL_LABELS: Record<string, string> = {
  customer: 'Müşteri kanalı',
  seller: 'Tasarımcı kanalı',
}

export function AdminProductQuestionConversation({
  threadId,
  messages,
  canCompleteReview,
}: {
  threadId: string
  messages: Message[]
  canCompleteReview: boolean
}) {
  const router = useRouter()
  const [audience, setAudience] = useState('customer')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState<'reply' | 'review' | null>(null)
  const [error, setError] = useState('')
  const lastSeenMessageId = messages[messages.length - 1]?.id

  function handleUseAnswer(message: Message) {
    if (
      body.trim() &&
      body !== message.body &&
      !window.confirm('Yazdığınız taslak tasarımcı yanıtıyla değiştirilsin mi?')
    )
      return
    setAudience('customer')
    setBody(message.body)
    setError('')
    document.getElementById('product-question-reply')?.focus()
  }

  async function submit(operation: 'reply' | 'review') {
    if (pending || (operation === 'reply' && body.trim().length < 2)) return
    setPending(operation)
    setError('')
    try {
      const response = await csrfFetch(
        `/api/admin/product-questions/${threadId}/${operation === 'reply' ? 'messages' : 'review-complete'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation === 'reply' ? { audience, body } : { lastSeenMessageId }),
        },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        setError(payload?.message ?? payload?.error?.message ?? 'İşlem tamamlanamadı.')
        if (response.status === 409) router.refresh()
        return
      }
      if (operation === 'reply') setBody('')
      router.refresh()
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      <ol
        aria-label="Konuşma mesajları"
        className="space-y-4 rounded-xl border p-4"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        {messages.map((message) => (
          <li key={message.id} className="space-y-2">
            <div
              className="flex flex-wrap items-center gap-2 text-xs"
              style={{ color: 'var(--color-muted-fg)' }}
            >
              <span className="font-semibold">
                {ROLE_LABELS[message.authorRole] ?? message.authorRole}
              </span>
              <span className="rounded-full border px-2 py-0.5">
                {CHANNEL_LABELS[message.audience ?? ''] ?? 'Yalnız yönetim'}
              </span>
              <time dateTime={message.createdAt}>
                {new Date(message.createdAt).toLocaleString('tr-TR', {
                  timeZone: 'Europe/Istanbul',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </time>
            </div>
            <p
              className="whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: 'var(--color-muted)',
                color: 'var(--color-primary)',
              }}
            >
              {message.body}
            </p>
            {message.authorRole === 'seller' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending !== null}
                onClick={() => handleUseAnswer(message)}
              >
                Yanıta al
              </Button>
            ) : null}
          </li>
        ))}
      </ol>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit('reply')
        }}
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <label className="block text-sm" htmlFor="product-question-audience">
          Mesajın alıcısı
        </label>
        <select
          id="product-question-audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
          className="rounded border p-2 text-sm"
          disabled={pending !== null}
        >
          <option value="customer">Müşteri</option>
          <option value="seller">Tasarımcı</option>
        </select>
        <label className="block text-sm font-medium" htmlFor="product-question-reply">
          Yanıtınız
        </label>
        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Tasarımcı yanıtını düzenleyerek gönderebilir veya kendi cevabınızı yazabilirsiniz. Mesaj
          yalnız seçilen alıcıya iletilir.
        </p>
        <Textarea
          id="product-question-reply"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
          rows={5}
          disabled={pending !== null}
        />
        <Button
          type="submit"
          loading={pending === 'reply'}
          disabled={pending !== null || body.trim().length < 2}
        >
          Mesajı gönder
        </Button>
      </form>

      {canCompleteReview && lastSeenMessageId ? (
        <div
          className="space-y-2 rounded-xl border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="text-sm">
            Müşteri zaten yanıtlandı. Tasarımcının yeni mesajı ek bir müşteri yanıtı gerektirmiyorsa
            incelemeyi tamamlayabilirsiniz.
          </p>
          <Button
            type="button"
            variant="outline"
            loading={pending === 'review'}
            disabled={pending !== null}
            onClick={() => void submit('review')}
          >
            İncelemeyi tamamla
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
