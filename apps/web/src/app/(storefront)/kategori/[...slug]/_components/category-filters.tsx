'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useRef } from 'react'
import { FilterSection } from '@/components/storefront/filter-section'
import {
  clearListingFilters,
  countActiveListingFilters,
  parseListingSearchParams,
} from '@/lib/product-listing-query'

export interface FilterSeller {
  id: string
  slug: string
  displayName: string | null
  productCount: number
}

export interface FilterSubcategory {
  id: string
  slug: string
  name: string
}

interface CategoryFiltersProps {
  minPrice?: number
  maxPrice?: number
  inStockOnly?: boolean
  onSaleOnly?: boolean
  activeSeller?: string
  activeSubcategory?: string
  sellers: FilterSeller[]
  /** Children of the deepest selected category — the next level to choose from. */
  subcategories: FilterSubcategory[]
  /** Path from the page scope down to the selected category, for stepping back up. */
  categoryTrail?: FilterSubcategory[]
}

export function CategoryFilters({
  minPrice,
  maxPrice,
  inStockOnly,
  onSaleOnly,
  activeSeller,
  activeSubcategory,
  sellers,
  subcategories,
  categoryTrail = [],
}: CategoryFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const minRef = useRef<HTMLInputElement>(null)
  const maxRef = useRef<HTMLInputElement>(null)

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      params.delete('sayfa')
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  function handlePriceApply() {
    const min = minRef.current?.value.trim() ?? ''
    const max = maxRef.current?.value.trim() ?? ''
    updateParams({
      fiyatMin: min || null,
      fiyatMax: max || null,
      fiyat: null,
    })
  }

  function handleStockChange(checked: boolean) {
    updateParams({ stokta: checked ? '1' : null })
  }

  function handleSaleChange(checked: boolean) {
    updateParams({
      indirimli: checked ? '1' : null,
      ...(!checked && searchParams.get('vitrin') === 'discounts' ? { vitrin: null } : {}),
    })
  }

  function handleSellerChange(slug: string) {
    updateParams({ tasarimci: activeSeller === slug ? null : slug })
  }

  /** `alt` points at the deepest selected node; descending replaces it. */
  function handleSubcategoryChange(slug: string) {
    updateParams({ alt: activeSubcategory === slug ? null : slug })
  }

  function handleTrailChange(slug: string | null) {
    updateParams({ alt: slug })
  }

  const hasActiveFilters =
    countActiveListingFilters(parseListingSearchParams(Object.fromEntries(searchParams))) > 0

  return (
    <div>
      {/* Alt Kategori — steps down one level at a time until the leaf */}
      {(subcategories.length > 0 || categoryTrail.length > 0) && (
        <FilterSection title="Alt Kategori">
          {categoryTrail.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleTrailChange(null)}
                className="underline"
                style={{ color: 'var(--color-muted-fg)' }}
              >
                Tümü
              </button>
              {categoryTrail.map((step, index) => {
                const isLast = index === categoryTrail.length - 1
                return (
                  <span key={step.id} className="flex items-center gap-1">
                    <span style={{ color: 'var(--color-muted-fg)' }}>›</span>
                    {isLast ? (
                      <span
                        style={{
                          color: 'var(--color-primary)',
                          fontWeight: 600,
                        }}
                      >
                        {step.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleTrailChange(step.slug)}
                        className="underline"
                        style={{ color: 'var(--color-muted-fg)' }}
                      >
                        {step.name}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          )}

          {subcategories.length > 0 ? (
            <ul className="space-y-1">
              {subcategories.map((sub) => (
                <li key={sub.id}>
                  <button
                    type="button"
                    onClick={() => handleSubcategoryChange(sub.slug)}
                    className="w-full rounded px-2 py-1 text-left text-sm transition-colors"
                    style={{
                      backgroundColor:
                        activeSubcategory === sub.slug ? 'var(--color-accent)' : 'transparent',
                      color: activeSubcategory === sub.slug ? '#fff' : 'var(--color-primary)',
                      fontWeight: activeSubcategory === sub.slug ? 600 : 400,
                    }}
                  >
                    {sub.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Bu en alt kategori.
            </p>
          )}
        </FilterSection>
      )}

      {/* Fiyat */}
      <FilterSection title="Fiyat Aralığı">
        <div className="flex items-center gap-2">
          <input
            key={`min-${searchParams.toString()}`}
            ref={minRef}
            aria-label="En düşük fiyat"
            type="number"
            min={0}
            defaultValue={minPrice ?? ''}
            placeholder="Min TL"
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-primary)',
            }}
          />
          <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            –
          </span>
          <input
            key={`max-${searchParams.toString()}`}
            ref={maxRef}
            aria-label="En yüksek fiyat"
            type="number"
            min={0}
            defaultValue={maxPrice ?? ''}
            placeholder="Max TL"
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-primary)',
            }}
          />
        </div>
        <button
          type="button"
          onClick={handlePriceApply}
          className="mt-2 w-full rounded-md py-1.5 text-xs font-medium"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: '#fff',
          }}
        >
          Uygula
        </button>
      </FilterSection>

      {/* Tasarımcı */}
      {sellers.length > 0 && (
        <FilterSection title="Tasarımcı">
          <ul
            className="max-h-52 space-y-1 overflow-y-auto pr-1"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--color-border) transparent',
            }}
          >
            {sellers.map((seller) => (
              <li key={seller.id}>
                <button
                  type="button"
                  onClick={() => handleSellerChange(seller.slug)}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm transition-colors"
                  style={{
                    backgroundColor:
                      activeSeller === seller.slug ? 'var(--color-accent)' : 'transparent',
                    color: activeSeller === seller.slug ? '#fff' : 'var(--color-primary)',
                  }}
                >
                  <span>{seller.displayName ?? seller.slug}</span>
                  <span
                    className="ml-1 text-xs"
                    style={{
                      color:
                        activeSeller === seller.slug
                          ? 'rgba(255,255,255,0.7)'
                          : 'var(--color-muted-fg)',
                    }}
                  >
                    {seller.productCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </FilterSection>
      )}

      {/* Ürün Durumu */}
      <FilterSection title="Ürün Durumu">
        <div className="space-y-2">
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--color-primary)' }}
          >
            <input
              type="checkbox"
              checked={onSaleOnly === true}
              onChange={(e) => handleSaleChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            İndirimli ürünler
          </label>
          <label
            className="flex cursor-pointer items-center gap-2 text-sm"
            style={{ color: 'var(--color-primary)' }}
          >
            <input
              type="checkbox"
              checked={inStockOnly === true}
              onChange={(e) => handleStockChange(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Sadece stokta olanlar
          </label>
        </div>
      </FilterSection>

      {/* Sıfırla */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => {
            const params = clearListingFilters(new URLSearchParams(searchParams.toString()))
            router.push(`${pathname}?${params.toString()}`, { scroll: false })
          }}
          className="mt-1 text-xs underline"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          Filtreleri sıfırla
        </button>
      )}
    </div>
  )
}
