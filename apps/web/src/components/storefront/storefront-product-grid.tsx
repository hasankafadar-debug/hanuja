'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ProductCard, useToast } from '@hanuja/ui'
import { csrfFetch } from '@/lib/csrf-fetch'

export interface StorefrontGridProduct {
  id: string
  title: string
  slug: string
  price: number
  comparePrice?: number | null
  imageUrl?: string | null
  imageUrls?: string[]
  sellerName?: string
  sellerSlug?: string
}

interface StorefrontProductGridProps {
  products: StorefrontGridProduct[]
  gridClassName?: string
}

function getApiMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'object' && payload !== null) {
    if ('message' in payload && typeof payload.message === 'string') return payload.message
    if ('error' in payload && typeof payload.error === 'string') return payload.error
  }

  return fallback
}

export default function StorefrontProductGrid({
  products,
  gridClassName = 'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4',
}: StorefrontProductGridProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [favoriteLoading, setFavoriteLoading] = useState<Record<string, boolean>>({})
  // The endpoint returns every favorite id for the user, so it does not depend
  // on which products are on screen. Keying this on the rendered ids would
  // refetch the whole list on each infinite-scroll page append.
  const hasProducts = products.length > 0

  useEffect(() => {
    let active = true

    async function loadFavoriteIds() {
      try {
        const res = await fetch('/api/user/favorites/ids', { cache: 'no-store' })

        if (res.status === 401) {
          if (active) setFavoriteIds(new Set())
          return
        }

        if (!res.ok) return

        const payload = await res.json().catch(() => null)
        const ids: unknown[] = Array.isArray(payload?.data) ? payload.data : []

        if (active) {
          setFavoriteIds(new Set(ids.filter((id): id is string => typeof id === 'string')))
        }
      } catch {
        if (active) setFavoriteIds(new Set())
      }
    }

    if (hasProducts) {
      void loadFavoriteIds()
    } else if (active) {
      setFavoriteIds(new Set())
    }

    return () => {
      active = false
    }
  }, [hasProducts])

  async function handleToggleFavorite(productId: string, nextState: boolean) {
    setFavoriteLoading((current) => ({ ...current, [productId]: true }))

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
        const callbackUrl = window.location.pathname + window.location.search
        router.push(`/giris?callbackUrl=${encodeURIComponent(callbackUrl)}`)
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

      setFavoriteIds((current) => {
        const next = new Set(current)
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
      setFavoriteLoading((current) => ({ ...current, [productId]: false }))
    }
  }

  return (
    <div className={gridClassName}>
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
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
          priority={index < 2}
        />
      ))}
    </div>
  )
}
