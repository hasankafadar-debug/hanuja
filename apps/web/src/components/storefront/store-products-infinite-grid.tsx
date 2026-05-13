'use client'

import { useEffect, useRef, useState } from 'react'
import { type StorefrontGridProduct } from './storefront-product-grid'
import StorefrontProductGrid from './storefront-product-grid'

interface StoreProductsInfiniteGridProps {
  initialProducts: StorefrontGridProduct[]
  initialCursor: string | null
  sellerSlug: string
}

export default function StoreProductsInfiniteGrid({
  initialProducts,
  initialCursor,
  sellerSlug,
}: StoreProductsInfiniteGridProps) {
  const [products, setProducts] = useState<StorefrontGridProduct[]>(initialProducts)
  const [cursor, setCursor] = useState<string | null>(initialCursor)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(initialCursor === null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (done) return

    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading) {
          void loadMore()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, loading, cursor])

  async function loadMore() {
    if (loading || done) return
    setLoading(true)

    try {
      const params = new URLSearchParams({ take: '20' })
      if (cursor) params.set('cursor', cursor)

      const res = await fetch(
        `/api/storefront/store/${sellerSlug}/products?${params.toString()}`,
      )
      if (!res.ok) return

      const data = (await res.json()) as {
        products: StorefrontGridProduct[]
        nextCursor: string | null
        hasMore: boolean
      }

      setProducts((prev) => [...prev, ...data.products])
      setCursor(data.nextCursor)
      if (!data.hasMore) setDone(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <StorefrontProductGrid
        gridClassName="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4"
        products={products}
      />

      {!done && (
        <div ref={sentinelRef} className="mt-8">
          {loading && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl"
                  style={{ backgroundColor: 'var(--color-border)', aspectRatio: '3/4' }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {done && products.length > 0 && (
        <p
          className="mt-8 text-center text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          Tüm ürünler yüklendi
        </p>
      )}
    </>
  )
}
