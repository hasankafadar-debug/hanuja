'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProductCard, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'
import type { StorefrontGridProduct } from './storefront-product-grid'

const CARD_GAP = 16
// Sürekli kayma hızı — piksel/saniye. Sakin, okunabilir bir vitrin temposu.
const SPEED_PX_PER_SEC = 40
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
  const isPausedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameTsRef = useRef<number | null>(null)

  const [cardWidth, setCardWidth] = useState(280)
  const [containerWidth, setContainerWidth] = useState(0)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteLoading, setFavoriteLoading] = useState<Record<string, boolean>>({})

  const productIdsKey = products.map((p) => p.id).join('|')

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
    }
    compute()
    const obs = new ResizeObserver(compute)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // ── Continuous marquee ────────────────────────────────────────────────────
  //
  // The track renders [products, products] as one flex row. One copy spans
  // exactly `products.length * (cardWidth + CARD_GAP)` px (each cell + its
  // trailing gap), so wrapping the offset by that period is seamless — the
  // second copy is pixel-identical to the first.
  //
  // The offset advances inside a requestAnimationFrame loop and is written
  // straight to the DOM node (no state) to avoid re-rendering every frame.
  // Hover freezes the offset (isPausedRef); prefers-reduced-motion disables
  // the loop entirely (same precedent as HeroSlider).
  const contentWidth = products.length * (cardWidth + CARD_GAP)
  const shouldAnimate = products.length > 0 && contentWidth > containerWidth

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    // Yeni ölçüm/veri: kaymayı baştan başlat.
    offsetRef.current = 0
    lastFrameTsRef.current = null
    track.style.transform = 'translateX(0px)'

    if (!shouldAnimate) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reducedMotion.matches) return

    const step = (ts: number) => {
      const last = lastFrameTsRef.current
      lastFrameTsRef.current = ts

      if (!isPausedRef.current && last !== null) {
        const deltaSeconds = Math.min((ts - last) / 1000, 0.1)
        let next = offsetRef.current + SPEED_PX_PER_SEC * deltaSeconds
        if (next >= contentWidth) next -= contentWidth
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
  }, [shouldAnimate, contentWidth, productIdsKey])

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

  const cardHeight = cardWidth + CARD_CONTENT_RESERVED_HEIGHT

  function renderCard(product: StorefrontGridProduct, key: string) {
    return (
      <div key={key} style={{ width: `${cardWidth}px`, height: `${cardHeight}px`, flexShrink: 0 }}>
        <ProductCard
          id={product.id}
          title={product.title}
          slug={product.slug}
          price={product.price}
          className="h-full"
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
    <div
      ref={containerRef}
      className="overflow-hidden"
      onMouseEnter={() => { isPausedRef.current = true }}
      onMouseLeave={() => { isPausedRef.current = false }}
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
    </div>
  )
}
