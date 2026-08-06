'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import StorefrontProductGrid, {
  type StorefrontGridProduct,
} from './storefront-product-grid'

interface ProductsInfiniteGridProps {
  initialProducts: StorefrontGridProduct[]
  /** Total matching products, so the grid knows when to stop. */
  total: number
  /** Serialized filters for /api/storefront/products, without `sayfa`. */
  listingQuery: string
  /**
   * Page rendered on the server. Normally 1, but `?sayfa=N` URLs stay valid
   * (crawlers and bookmarks land on them), so scrolling continues from N+1.
   */
  initialPage: number
  gridClassName: string
  pageSize: number
}

interface LoadMoreResponse {
  products: StorefrontGridProduct[]
  total: number
  hasMore: boolean
}

/**
 * Appends further pages as the shopper scrolls. Page 1 stays server-rendered by
 * the listing page — this only fetches 2..N, so the crawlable markup is
 * unchanged.
 *
 * Mount this with `key={listingQuery}` so a filter or sort change remounts it
 * with a clean list instead of appending onto the previous result set.
 */
export default function ProductsInfiniteGrid({
  initialProducts,
  total,
  listingQuery,
  initialPage,
  gridClassName,
  pageSize,
}: ProductsInfiniteGridProps) {
  const skippedByServer = (initialPage - 1) * pageSize
  const [products, setProducts] = useState<StorefrontGridProduct[]>(initialProducts)
  const [nextPage, setNextPage] = useState(initialPage + 1)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [done, setDone] = useState(skippedByServer + initialProducts.length >= total)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const loadMore = useCallback(async () => {
    if (loading || done) return
    setLoading(true)
    setFailed(false)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch(
        `/api/storefront/products?${listingQuery}${listingQuery ? '&' : ''}sayfa=${nextPage}`,
        { signal: controller.signal },
      )
      if (!res.ok) {
        // Surface it instead of letting the observer retry the same failure
        // forever, which is what a silent return would cause.
        setFailed(true)
        return
      }

      const data = (await res.json()) as LoadMoreResponse
      setProducts((prev) => {
        const seen = new Set(prev.map((product) => product.id))
        return [...prev, ...data.products.filter((product) => !seen.has(product.id))]
      })
      setNextPage((page) => page + 1)
      if (!data.hasMore || data.products.length === 0) setDone(true)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setFailed(true)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [loading, done, listingQuery, nextPage])

  useEffect(() => {
    if (done || failed) return

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
  }, [done, failed, loading, loadMore])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const skeletonCount = Math.min(pageSize, 4)

  return (
    <>
      <StorefrontProductGrid gridClassName={gridClassName} products={products} />

      {!done && (
        <div ref={sentinelRef} className="mt-8">
          {loading && (
            <div className={gridClassName}>
              {Array.from({ length: skeletonCount }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl"
                  style={{ backgroundColor: 'var(--color-border)', aspectRatio: '3/4' }}
                />
              ))}
            </div>
          )}

          {failed && !loading && (
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Ürünler yüklenemedi.
              </p>
              <button
                type="button"
                onClick={() => void loadMore()}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                Tekrar dene
              </button>
            </div>
          )}
        </div>
      )}

      {done && products.length > 0 && (
        <p className="mt-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Tüm ürünler yüklendi
        </p>
      )}
    </>
  )
}
