'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import { PRODUCT_QUESTION_MAX_LENGTH, productQuestionApiMessage } from './api-message'

interface AskQuestionPanelProps {
  productId: string
  orderId?: string
  /** In-app path to return to after login (the panel re-opens there). */
  loginReturnPath: string
  autoFocus?: boolean
  onCancel?: () => void
}

export function AskQuestionPanel({
  productId,
  orderId,
  loginReturnPath,
  autoFocus = false,
  onCancel,
}: AskQuestionPanelProps) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return
    if (body.trim().length < 2) {
      setError('Lütfen sorunuzu yazın.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await csrfFetch('/api/product-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, ...(orderId ? { orderId } : {}), body }),
      })
      const payload = (await res.json().catch(() => null)) as
        | { data?: { threadId?: string } }
        | null
      if (res.status === 401) {
        router.push(`/giris?callbackUrl=${encodeURIComponent(loginReturnPath)}`)
        return
      }
      if (!res.ok || !payload?.data?.threadId) {
        setError(productQuestionApiMessage(payload, 'Sorunuz gönderilemedi. Lütfen tekrar deneyin.'))
        return
      }
      router.push(`/hesabim/sorularim/${payload.data.threadId}`)
    } catch {
      setError('Bağlantı hatası. Lütfen tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border p-4"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      aria-label="Satıcıya soru sor"
    >
      <div>
        <label htmlFor={`question-${productId}`} className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
          Satıcıya sorunuz
        </label>
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Konuşma herkese açık değildir. Siz, ilgili satıcı ve denetim amacıyla yetkili yöneticiler
          erişebilir. Telefon, e-posta, adres veya bağlantı paylaşmayın.
        </p>
      </div>
      <textarea
        id={`question-${productId}`}
        ref={textareaRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        maxLength={PRODUCT_QUESTION_MAX_LENGTH}
        disabled={submitting}
        placeholder="Örneğin: Ürünün ölçüleri ve malzemesi hakkında bilgi verebilir misiniz?"
        className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-primary)',
        }}
      />
      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        <span>
          {body.length} / {PRODUCT_QUESTION_MAX_LENGTH}
        </span>
      </div>
      {error ? (
        <p className="text-sm" role="alert" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Vazgeç
          </Button>
        ) : null}
        <Button type="submit" loading={submitting}>
          Soruyu Gönder
        </Button>
      </div>
    </form>
  )
}
