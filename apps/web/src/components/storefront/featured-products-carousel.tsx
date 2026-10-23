'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { ProductCard, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import type { StorefrontGridProduct } from './storefront-product-grid'

const CARD_GAP = 16
// Sürekli kayma hızı — piksel/saniye. Sakin, okunabilir bir vitrin temposu.
const SPEED_PX_PER_SEC = 46
const EDGE_ZONE_RATIO = 0.3
const FAST_EDGE_RATIO = 0.01
const MAX_SPEED_MULTIPLIER = 3
type EdgeDirection = 'previous' | 'next' | null
// Görsel (kare, yükseklik = kart genişliği) altındaki içerik alanı için ayrılan
// sabit yükseklik: satıcı adı + 2 satır başlık + fiyat satırı + padding.
// Tüm kartların eşit yükseklikte olmasını sağlar (ProductCard `h-full` +
// `mt-auto` fiyatı alta sabitler).
const CARD_CONTENT_RESERVED_HEIGHT = 168

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

  // rAF-driven marquee state — refs only, no per-frame React re-render.
  const offsetRef = useRef(0)
  const velocityRef = useRef(SPEED_PX_PER_SEC)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const supportsHoverRef = useRef(false)
  const isPressedRef = useRef(false)
  const hasKeyboardFocusRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameTsRef = useRef<number | null>(null)

  const [cardWidth, setCardWidth] = useState(280)
  const [containerWidth, setContainerWidth] = useState(0)
  const [motionAllowed, setMotionAllowed] = useState(false)
  const [edgeDirection, setEdgeDirection] = useState<EdgeDirection>(null)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteLoading, setFavoriteLoading] = useState<
    Record<string, boolean>
  >({})

  const productIdsKey = products.map((p) => p.id).join('|')

  const syncPointerMotion = useCallback(() => {
    const pointer = pointerRef.current
    const rect = containerRef.current?.getBoundingClientRect()
    if (
      !pointer ||
      !rect ||
      !rect.width ||
      pointer.x < rect.left ||
      pointer.x > rect.right ||
      pointer.y < rect.top ||
      pointer.y > rect.bottom
    ) {
      pointerRef.current = null
      velocityRef.current = SPEED_PX_PER_SEC
      setEdgeDirection(null)
      return
    }

    const ratio = (pointer.x - rect.left) / rect.width
    const direction =
      ratio < EDGE_ZONE_RATIO
        ? 'previous'
        : ratio > 1 - EDGE_ZONE_RATIO
          ? 'next'
          : null
    const distanceToEdge = Math.min(ratio, 1 - ratio)
    const progress = Math.min(
      1,
      Math.max(
        0,
        (EDGE_ZONE_RATIO - distanceToEdge) /
          (EDGE_ZONE_RATIO - FAST_EDGE_RATIO),
      ),
    )
    // Ease into and out of acceleration, with no speed jump at the outer 1%.
    const boost = progress * progress * (3 - 2 * progress)
    const speed = SPEED_PX_PER_SEC * (1 + (MAX_SPEED_MULTIPLIER - 1) * boost)
    velocityRef.current =
      direction === 'previous' ? -speed : direction === 'next' ? speed : 0
    setEdgeDirection(direction)
  }, [])

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const hover = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => {
      setMotionAllowed(!reducedMotion.matches)
      supportsHoverRef.current = hover.matches
      if (!hover.matches) pointerRef.current = null
      syncPointerMotion()
    }
    const release = () => {
      isPressedRef.current = false
    }
    const reset = () => {
      release()
      pointerRef.current = null
      syncPointerMotion()
    }
    sync()
    reducedMotion.addEventListener('change', sync)
    hover.addEventListener('change', sync)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', reset)
    return () => {
      reducedMotion.removeEventListener('change', sync)
      hover.removeEventListener('change', sync)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', reset)
    }
  }, [syncPointerMotion])

  // ── Layout: compute card size from container ──────────────────────────────
  useEffect(() => {
    const compute = () => {
      if (!containerRef.current) return
      const trackWidth = containerRef.current.clientWidth
      let count: number
      if (trackWidth >= 960) count = 5
      else if (trackWidth >= 720) count = 4
      else if (trackWidth >= 480) count = 3
      else if (trackWidth >= 280) count = 2
      else count = 1
      setContainerWidth(trackWidth)
      setCardWidth(Math.floor((trackWidth - CARD_GAP * (count - 1)) / count))
      syncPointerMotion()
    }
    compute()
    const obs = new ResizeObserver(compute)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [syncPointerMotion])

  // ── Continuous marquee ────────────────────────────────────────────────────
  //
  // The track renders [products, products] as one flex row. One copy spans
  // exactly `products.length * (cardWidth + CARD_GAP)` px (each cell + its
  // trailing gap), so wrapping the offset by that period is seamless — the
  // second copy is pixel-identical to the first.
  //
  // The offset advances inside a requestAnimationFrame loop and is written
  // straight to the DOM node (no state) to avoid re-rendering every frame.
  // Signed velocity allows both directions. The middle 40% pauses the track;
  // Each 30% edge zone pans toward that side, easing from normal speed
  // to three times normal speed in the outermost 1%.
  const contentWidth = products.length * (cardWidth + CARD_GAP)
  // The final trailing gap belongs to the loop period, not the visible content.
  const shouldAnimate =
    containerWidth > 0 &&
    products.length > 0 &&
    contentWidth - CARD_GAP > containerWidth

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    // Yeni ölçüm/veri: kaymayı baştan başlat.
    offsetRef.current = 0
    lastFrameTsRef.current = null
    track.style.transform = 'translateX(0px)'

    if (!shouldAnimate || !motionAllowed) return

    const step = (ts: number) => {
      const last = lastFrameTsRef.current
      lastFrameTsRef.current = ts

      if (
        !isPressedRef.current &&
        !hasKeyboardFocusRef.current &&
        !document.hidden &&
        last !== null
      ) {
        const deltaSeconds = Math.min((ts - last) / 1000, 0.1)
        const distance = offsetRef.current + velocityRef.current * deltaSeconds
        const next = ((distance % contentWidth) + contentWidth) % contentWidth
        offsetRef.current = next
        track.style.transform = `translateX(-${next}px)`
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [shouldAnimate, motionAllowed, contentWidth, productIdsKey])

  // ── Favorites ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const res = await fetch('/api/user/favorites/ids', {
          cache: 'no-store',
        })
        if (res.status === 401) {
          if (active) setFavoriteIds(new Set())
          return
        }
        if (!res.ok) return
        const payload = await res.json().catch(() => null)
        const ids: unknown[] = Array.isArray(payload?.data) ? payload.data : []
        if (active)
          setFavoriteIds(
            new Set(ids.filter((id): id is string => typeof id === 'string')),
          )
      } catch {
        if (active) setFavoriteIds(new Set())
      }
    }
    if (products.length > 0) void load()
    else if (active) setFavoriteIds(new Set())
    return () => {
      active = false
    }
  }, [products.length, productIdsKey])

  async function handleToggleFavorite(productId: string, nextState: boolean) {
    setFavoriteLoading((cur) => ({ ...cur, [productId]: true }))
    try {
      const response = await csrfFetch(
        nextState ? '/api/user/favorites' : `/api/user/favorites/${productId}`,
        nextState
          ? {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ productId }),
            }
          : { method: 'DELETE' },
      )
      if (response.status === 401) {
        router.push(
          `/giris?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        )
        return
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        toast({
          title: 'Favori işlemi başarısız',
          description: getApiMessage(payload, 'Lütfen tekrar deneyin.'),
          variant: 'destructive',
        })
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
        description: nextState
          ? 'Ürün Favorilerim listesine kaydedildi.'
          : 'Ürün Favorilerim listesinden kaldırıldı.',
        variant: 'success',
      })
    } finally {
      setFavoriteLoading((cur) => ({ ...cur, [productId]: false }))
    }
  }

  if (products.length === 0) return null

  const cardHeight = cardWidth + CARD_CONTENT_RESERVED_HEIGHT

  function renderCard(product: StorefrontGridProduct, key: string) {
    return (
      <div
        key={key}
        style={{
          width: `${cardWidth}px`,
          height: `${cardHeight}px`,
          flexShrink: 0,
        }}
      >
        <ProductCard
          id={product.id}
          title={product.title}
          slug={product.slug}
          price={product.price}
          className="h-full"
          {...(product.comparePrice !== undefined
            ? { comparePrice: product.comparePrice }
            : {})}
          {...(product.imageUrl !== undefined
            ? { imageUrl: product.imageUrl }
            : {})}
          {...(product.imageUrls !== undefined
            ? { imageUrls: product.imageUrls }
            : {})}
          {...(product.sellerName !== undefined
            ? { sellerName: product.sellerName }
            : {})}
          {...(product.sellerSlug !== undefined
            ? { sellerSlug: product.sellerSlug }
            : {})}
          isFavorited={favoriteIds.has(product.id)}
          favoriteLoading={Boolean(favoriteLoading[product.id])}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      data-testid="featured-products-carousel"
      className="relative overflow-hidden"
      onPointerMove={(event) => {
        if (!supportsHoverRef.current || event.pointerType === 'touch') return
        pointerRef.current = { x: event.clientX, y: event.clientY }
        syncPointerMotion()
      }}
      onPointerEnter={(event) => {
        if (!supportsHoverRef.current || event.pointerType === 'touch') return
        pointerRef.current = { x: event.clientX, y: event.clientY }
        syncPointerMotion()
      }}
      onPointerLeave={() => {
        pointerRef.current = null
        syncPointerMotion()
      }}
      onPointerDownCapture={() => {
        isPressedRef.current = true
        hasKeyboardFocusRef.current = false
      }}
      onFocusCapture={(event) => {
        hasKeyboardFocusRef.current = event.target.matches(':focus-visible')
      }}
      onKeyDownCapture={() => {
        hasKeyboardFocusRef.current = true
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          hasKeyboardFocusRef.current = false
      }}
    >
      <div
        ref={trackRef}
        className="flex"
        style={{ gap: `${CARD_GAP}px`, willChange: 'transform' }}
      >
        {products.map((product) => renderCard(product, product.id))}
        {/* İkinci kopya — kusursuz sonsuz döngü için birebir tekrar */}
        {shouldAnimate &&
          products.map((product) => renderCard(product, `loop-${product.id}`))}
      </div>
      {shouldAnimate && motionAllowed && (
        <>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute left-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-opacity duration-150 motion-reduce:transition-none ${edgeDirection === 'previous' ? 'opacity-100' : 'opacity-0'}`}
            style={{
              top: cardWidth / 2,
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-primary)',
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </span>
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute right-3 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-opacity duration-150 motion-reduce:transition-none ${edgeDirection === 'next' ? 'opacity-100' : 'opacity-0'}`}
            style={{
              top: cardWidth / 2,
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-primary)',
            }}
          >
            <ArrowRight className="h-4 w-4" />
          </span>
        </>
      )}
    </div>
  )
}
