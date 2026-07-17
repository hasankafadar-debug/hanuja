'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { SlidersHorizontal, X, Package } from 'lucide-react'
import { EmptyState } from '@hanuja/ui'
import StorefrontProductGrid, {
  type StorefrontGridProduct,
} from '@/components/storefront/storefront-product-grid'
import { CategoryPagination } from './category-pagination'

interface CategoryPageBodyProps {
  filterContent: ReactNode
  sortContent: ReactNode
  products: StorefrontGridProduct[]
  totalProducts: number
  currentPage: number
  totalPages: number
  categoryPath: string
  paginationBasePath?: string
  activeFilterCount: number
}

const GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'

export function CategoryPageBody({
  filterContent,
  sortContent,
  products,
  totalProducts,
  currentPage,
  totalPages,
  categoryPath,
  paginationBasePath,
  activeFilterCount,
}: CategoryPageBodyProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onClearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('fiyat')
    params.delete('fiyatMin')
    params.delete('fiyatMax')
    params.delete('stokta')
    params.delete('indirimli')
    params.delete('tasarimci')
    params.delete('alt')
    params.delete('sayfa')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [router, pathname, searchParams])

  // Click-outside to close
  useEffect(() => {
    if (!isFilterOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFilterOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isFilterOpen])

  return (
    <>
      {/* Toolbar: filter toggle + clear + sort */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div ref={containerRef} className="relative">
          <button
            type="button"
            onClick={() => setIsFilterOpen((v) => !v)}
            className="flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: isFilterOpen ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: isFilterOpen ? 'var(--color-accent)' : 'var(--color-surface)',
              color: isFilterOpen ? '#fff' : 'var(--color-primary)',
            }}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtrele
            {activeFilterCount > 0 && (
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold"
                style={{
                  backgroundColor: isFilterOpen ? 'rgba(255,255,255,0.25)' : 'var(--color-accent)',
                  color: '#fff',
                }}
              >
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Filter dropdown panel */}
          {isFilterOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border shadow-lg"
              style={{
                borderColor: 'var(--color-border)',
                backgroundColor: 'var(--color-surface)',
              }}
            >
              <div className="max-h-[70vh] overflow-y-auto p-4">
                {filterContent}
              </div>
              <div
                className="border-t px-4 py-3"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <button
                  type="button"
                  onClick={() => setIsFilterOpen(false)}
                  className="w-full rounded-lg py-2 text-sm font-medium text-white transition-colors"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  Tamam
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Filtre Temizle — only when filters active */}
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={onClearFilters}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-muted-fg)',
            }}
          >
            <X className="h-3.5 w-3.5" />
            Filtre Temizle
          </button>
        )}

        <div className="w-full min-w-0 sm:flex-1">{sortContent}</div>
      </div>

      {/* Product grid — always 4 cols */}
      {products.length === 0 ? (
        activeFilterCount > 0 ? (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Bu kategoride ürün bulunamadı"
            description="Filtrelerinizi değiştirerek tekrar deneyin."
          />
        ) : (
          <EmptyState
            icon={<Package className="h-6 w-6" />}
            title="Bu kategoride henüz yayınlanmış ürün bulunmuyor."
            description="Yeni ürünler eklendikçe burada görünecek."
          />
        )
      ) : (
        <>
          <StorefrontProductGrid gridClassName={GRID_CLASS} products={products} />
          {totalProducts > products.length && totalPages > 1 && (
            <div className="mt-10 flex justify-center">
              <CategoryPagination
                currentPage={currentPage}
                totalPages={totalPages}
                categoryPath={categoryPath}
                {...(paginationBasePath ? { basePath: paginationBasePath } : {})}
              />
            </div>
          )}
        </>
      )}
    </>
  )
}
