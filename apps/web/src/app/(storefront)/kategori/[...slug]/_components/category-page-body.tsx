'use client'

import { useState, type ReactNode } from 'react'
import { SlidersHorizontal, Package } from 'lucide-react'
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
  activeFilterCount: number
}

export function CategoryPageBody({
  filterContent,
  sortContent,
  products,
  totalProducts,
  currentPage,
  totalPages,
  categoryPath,
  activeFilterCount,
}: CategoryPageBodyProps) {
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  const gridClass = isFilterOpen
    ? 'grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-3'
    : 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4'

  return (
    <>
      {/* Toolbar: filter toggle + sort */}
      <div className="mb-4 flex items-center gap-3">
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

        <div className="flex-1">{sortContent}</div>
      </div>

      <div className="flex gap-6">
        {/* Collapsible filter panel */}
        {isFilterOpen && <div className="w-56 shrink-0">{filterContent}</div>}

        {/* Product area */}
        <div className="min-w-0 flex-1">
          {products.length === 0 ? (
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="Bu kategoride ürün bulunamadı"
              description="Filtrelerinizi değiştirerek tekrar deneyin."
            />
          ) : (
            <>
              <StorefrontProductGrid
                gridClassName={gridClass}
                products={products}
              />
              {totalProducts > products.length && totalPages > 1 && (
                <div className="mt-10 flex justify-center">
                  <CategoryPagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    categoryPath={categoryPath}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
