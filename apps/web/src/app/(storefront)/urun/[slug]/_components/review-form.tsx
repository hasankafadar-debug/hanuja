'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@hanuja/ui'
import { Star } from 'lucide-react'
import { csrfFetch } from '@/lib/csrf-fetch'

type EligibilityState =
  | { phase: 'loading' }
  | { phase: 'unauthenticated' }
  | { phase: 'eligible'; orderId: string }
  | { phase: 'no_purchase' }
  | { phase: 'not_delivery_confirmed' }
  | { phase: 'already_reviewed' }
  | { phase: 'error'; message: string }

interface Props {
  productSlug: string
}

const REASON_COPY: Record<
  Exclude<EligibilityState['phase'], 'loading' | 'unauthenticated' | 'eligible' | 'error'>,
  string
> = {
  no_purchase: 'Yalnızca bu ürünü satın alan müşteriler değerlendirme yazabilir.',
  not_delivery_confirmed:
    'Değerlendirme yazabilmen için siparişinin teslimatının onaylanmış olması gerekiyor.',
  already_reviewed: 'Bu sipariş için bu ürüne ait bir değerlendirmen zaten var.',
}

export default function ReviewForm({ productSlug }: Props) {
  const router = useRouter()
  const [state, setState] = useState<EligibilityState>({ phase: 'loading' })
  const [rating, setRating] = useState<number>(0)
  const [hoverRating, setHoverRating] = useState<number>(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(productSlug)}/reviews/eligibility`, {
          credentials: 'include',
        })
        if (cancelled) return
        if (res.status === 401) {
          setState({ phase: 'unauthenticated' })
          return
        }
        type EligibilityResponse =
          | { success: true; data: { eligible: true; orderId: string } | { eligible: false; reason: string } }
          | { success: false; message?: string }
        const json = (await res.json()) as EligibilityResponse
        if (cancelled) return
        if (json.success) {
          if (json.data.eligible) {
            setState({ phase: 'eligible', orderId: json.data.orderId })
          } else {
            const reason = json.data.reason as
              | 'no_purchase'
              | 'not_delivery_confirmed'
              | 'already_reviewed'
            setState({ phase: reason })
          }
        } else {
          setState({
            phase: 'error',
            message: json.message ?? 'Değerlendirme uygunluğu alınamadı',
          })
        }
      } catch {
        if (!cancelled) setState({ phase: 'error', message: 'Bağlantı hatası' })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [productSlug])

  if (state.phase === 'loading') {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        Değerlendirme uygunluğu kontrol ediliyor…
      </p>
    )
  }

  if (state.phase === 'unauthenticated') {
    return (
      <div className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
        <p style={{ color: 'var(--color-muted-fg)' }}>
          Değerlendirme yazmak için{' '}
          <button
            type="button"
            className="underline"
            onClick={() => router.push('/giris')}
            style={{ color: 'var(--color-accent)' }}
          >
            giriş yap
          </button>
          .
        </p>
      </div>
    )
  }

  if (state.phase === 'no_purchase' || state.phase === 'not_delivery_confirmed' || state.phase === 'already_reviewed') {
    return (
      <p className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}>
        {REASON_COPY[state.phase]}
      </p>
    )
  }

  if (state.phase === 'error') {
    return (
      <p className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive)' }}>
        {state.message}
      </p>
    )
  }

  if (submitted) {
    return (
      <p className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}>
        Değerlendirmen alındı. Moderasyon onayından sonra yayınlanacak.
      </p>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    if (rating < 1 || rating > 5) {
      setSubmitError('Lütfen 1-5 arası bir puan ver.')
      return
    }
    if (body.trim().length < 10) {
      setSubmitError('Yorum metni en az 10 karakter olmalı.')
      return
    }
    setSubmitting(true)
    try {
      const res = await csrfFetch(`/api/products/${encodeURIComponent(productSlug)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          title: title.trim() || undefined,
          body: body.trim(),
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        setSubmitError(data?.message ?? 'Değerlendirme gönderilemedi.')
        return
      }
      setSubmitted(true)
    } catch {
      setSubmitError('Bağlantı hatası. Tekrar deneyin.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-primary)' }}>
          Puan
        </label>
        <div className="flex gap-1" role="radiogroup" aria-label="Puan">
          {[1, 2, 3, 4, 5].map((i) => {
            const active = (hoverRating || rating) >= i
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={rating === i}
                aria-label={`${i} yıldız`}
                onClick={() => setRating(i)}
                onMouseEnter={() => setHoverRating(i)}
                onMouseLeave={() => setHoverRating(0)}
                className="p-1"
              >
                <Star
                  width={28}
                  height={28}
                  fill={active ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                  style={{ color: active ? '#f5b301' : 'var(--color-muted-fg)' }}
                />
              </button>
            )
          })}
        </div>
      </div>

      <div>
        <label htmlFor="review-title" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-primary)' }}>
          Başlık (opsiyonel)
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={140}
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)' }}
          placeholder="Kısa bir başlık"
        />
      </div>

      <div>
        <label htmlFor="review-body" className="block text-sm font-medium mb-1" style={{ color: 'var(--color-primary)' }}>
          Yorum
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={5}
          required
          className="w-full rounded-md border px-3 py-2 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-background)' }}
          placeholder="Ürün hakkındaki düşüncelerini paylaş…"
        />
        <p className="mt-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          {body.length} / 4000 karakter
        </p>
      </div>

      {submitError && (
        <p className="rounded-md border p-3 text-sm" style={{ borderColor: 'var(--color-destructive)', color: 'var(--color-destructive)' }}>
          {submitError}
        </p>
      )}

      <Button type="submit" disabled={submitting}>
        {submitting ? 'Gönderiliyor…' : 'Değerlendirmeyi Gönder'}
      </Button>
      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
        Değerlendirmen, moderasyon onayından sonra yayınlanır.
      </p>
    </form>
  )
}
