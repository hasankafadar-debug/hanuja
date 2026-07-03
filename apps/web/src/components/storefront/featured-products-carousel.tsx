'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { ProductCard, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import type { StorefrontGridProduct } from './storefront-product-grid'

const CARD_GAP = 16
const AUTO_PLAY_MS = 2000   // 2s aralık — her adımda 1 kart kayar
const TRANSITION_MS = 600   // geçiş süresi (ms)

function getApiMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const p = payload as Record<string, unknown>
    if (typeof p.message === 'string') return p.message
    if (typeof p.error === 'string') return p.error
  }
  return fallback
}

export default function FeaturedProductsCarousel({
  products,
}: {
  products: StorefrontGridProduct[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // true during the instant (no-animation) snap back to real position
  const isSnapping = useRef(false)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [cardWidth, setCardWidth] = useState(280)
  const [visibleCount, setVisibleCount] = useState(4)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteLoading, setFavoriteLoading] = useState<Record<string, boolean>>({})

  const productIdsKey = products.map((p) => p.id).join('|')

  // ── Layout: compute card size from container ──────────────────────────────
  useEffect(() => {
    const compute = () => {
      if (!containerRef.current) return
      // 44px per arrow × 2 + 8px gap × 2 = 104px
      const trackWidth = containerRef.current.clientWidth - 104
      let count: number
      if (trackWidth >= 960) count = 5
      else if (trackWidth >= 720) count = 4
      else if (trackWidth >= 480) count = 3
      else if (trackWidth >= 280) count = 2
      else count = 1
      setVisibleCount(count)
      setCardWidth(Math.floor((trackWidth - CARD_GAP * (count - 1)) / count))
    }
    compute()
    const obs = new ResizeObserver(compute)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // On resize: if we were in clone territory, reset to real position 0
  useEffect(() => {
    setCurrentIndex((prev) => (prev >= products.length ? 0 : prev))
  }, [visibleCount, products.length])

  // ── Infinite-loop clone technique ─────────────────────────────────────────
  //
  // Track layout: [real cards 0…n-1] [clone cards 0…visibleCount-1]
  //
  // The carousel advances normally into the clone zone (smooth animation).
  // When currentIndex reaches products.length (full clone view = same as 0),
  // we wait for the transition to finish, then instantly snap to 0.
  // The snap is invisible because both positions look identical.

  const clones = products.slice(0, visibleCount)

  // Detect entry into clone zone and schedule the silent snap
  useEffect(() => {
    if (currentIndex < products.length) return

    if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    snapTimerRef.current = setTimeout(() => {
      isSnapping.current = true
      setCurrentIndex((prev) => prev - products.length)
    }, TRANSITION_MS + 16) // wait for transition + 1 frame

    return () => {
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current)
    }
  }, [currentIndex, products.length])

  // Disable transition for the silent snap so the browser renders it instantly
  useLayoutEffect(() => {
    if (!isSnapping.current) return
    isSnapping.current = false
    const el = trackRef.current
    if (!el) return
    el.style.transition = 'none'
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (el) el.style.transition = `transform ${TRANSITION_MS}ms ease-in-out`
      })
    })
  }, [currentIndex])

  // ── Auto-play ─────────────────────────────────────────────────────────────
  const advance = useCallback(() => {
    setCurrentIndex((prev) => prev + 1)
  }, [])

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(advance, AUTO_PLAY_MS)
  }, [advance])

  useEffect(() => {
    startTimer()
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [startTimer])

  // ── Favorites ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch('/api/user/favorites/ids', { cache: 'no-store' })
        if (res.status === 401) { if (active) setFavoriteIds(new Set()); return }
        if (!res.ok) return
        const payload = await res.json().catch(() => null)
        const ids: unknown[] = Array.isArray(payload?.data) ? payload.data : []
        if (active)
          setFavoriteIds(new Set(ids.filter((id): id is string => typeof id === 'string')))
      } catch {
        if (active) setFavoriteIds(new Set())
      }
    }
    if (products.length > 0) void load()
    else if (active) setFavoriteIds(new Set())
    return () => { active = false }
  }, [products.length, productIdsKey])

  async function handleToggleFavorite(productId: string, nextState: boolean) {
    setFavoriteLoading((cur) => ({ ...cur, [productId]: true }))
    try {
      const response = await csrfFetch(
        nextState ? '/api/user/favorites' : `/api/user/favorites/${productId}`,
        nextState
          ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId }) }
          : { method: 'DELETE' },
      )
      if (response.status === 401) {
        router.push(`/giris?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`)
        return
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        toast({ title: 'Favori işlemi başarısız', description: getApiMessage(payload, 'Lütfen tekrar deneyin.'), variant: 'destructive' })
        return
      }
      setFavoriteIds((cur) => {
        const next = new Set(cur)
        if (nextState) next.add(productId)
        else next.delete(productId)
        return next
      })
      toast({
        title: nextState ? 'Favorilere eklendi' : 'Favorilerden çıkarıldı',
        description: nextState ? 'Ürün Favorilerim listesine kaydedildi.' : 'Ürün Favorilerim listesinden kaldırıldı.',
        variant: 'success',
      })
    } finally {
      setFavoriteLoading((cur) => ({ ...cur, [productId]: false }))
    }
  }

  if (products.length === 0) return null

  const translateX = currentIndex * (cardWidth + CARD_GAP)

  const arrowCls =
    'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border shadow-sm transition-all duration-200 hover:scale-105'

  function renderCard(product: StorefrontGridProduct, key: string) {
    return (
      <div key={key} style={{ width: `${cardWidth}px`, flexShrink: 0 }}>
        <ProductCard
          id={product.id}
          title={product.title}
          slug={product.slug}
          price={product.price}
          {...(product.comparePrice !== undefined ? { comparePrice: product.comparePrice } : {})}
          {...(product.imageUrl !== undefined ? { imageUrl: product.imageUrl } : {})}
          {...(product.imageUrls !== undefined ? { imageUrls: product.imageUrls } : {})}
          {...(product.sellerName !== undefined ? { sellerName: product.sellerName } : {})}
          {...(product.sellerSlug !== undefined ? { sellerSlug: product.sellerSlug } : {})}
          isFavorited={favoriteIds.has(product.id)}
          favoriteLoading={Boolean(favoriteLoading[product.id])}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex items-center gap-2">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => { setCurrentIndex((prev) => Math.max(0, prev - 1)); startTimer() }}
        aria-label="Önceki ürünler"
        className={arrowCls}
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.backgroundColor = 'var(--color-accent)'
          el.style.borderColor = 'var(--color-accent)'
          el.style.color = 'white'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.backgroundColor = 'var(--color-surface)'
          el.style.borderColor = 'var(--color-border)'
          el.style.color = 'var(--color-primary)'
        }}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Carousel track */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          ref={trackRef}
          className="flex"
          style={{
            gap: `${CARD_GAP}px`,
            transform: `translateX(-${translateX}px)`,
            transition: `transform ${TRANSITION_MS}ms ease-in-out`,
            willChange: 'transform',
          }}
        >
          {/* Real cards */}
          {products.map((product) => renderCard(product, product.id))}
          {/* Clone cards — seamless loop buffer */}
          {clones.map((product, i) => renderCard(product, `clone-${i}-${product.id}`))}
        </div>
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => { advance(); startTimer() }}
        aria-label="Sonraki ürünler"
        className={arrowCls}
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.backgroundColor = 'var(--color-accent)'
          el.style.borderColor = 'var(--color-accent)'
          el.style.color = 'white'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.backgroundColor = 'var(--color-surface)'
          el.style.borderColor = 'var(--color-border)'
          el.style.color = 'var(--color-primary)'
        }}
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}
