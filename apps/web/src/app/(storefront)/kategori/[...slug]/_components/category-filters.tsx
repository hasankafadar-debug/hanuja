'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

const PRICE_RANGES = [
  { label: '0 – 500 ₺', value: '0-500' },
  { label: '500 – 1.500 ₺', value: '500-1500' },
  { label: '1.500 – 3.000 ₺', value: '1500-3000' },
  { label: '3.000 ₺ ve üzeri', value: '3000+' },
]

interface CategoryFiltersProps {
  activePriceRange?: string
  inStockOnly?: boolean
}

export function CategoryFilters({ activePriceRange, inStockOnly }: CategoryFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === null || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      // Reset to page 1 when filter changes
      params.delete('sayfa')
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  function handlePriceChange(value: string, checked: boolean) {
    if (checked) {
      updateParam('fiyat', value)
    } else if (activePriceRange === value) {
      updateParam('fiyat', null)
    }
  }

  function handleStockChange(checked: boolean) {
    updateParam('stokta', checked ? '1' : null)
  }

  return (
    <aside className="shrink-0 lg:w-56">
      <div
        className="rounded-xl border p-5"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="8" y1="12" x2="16" y2="12" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--color-primary)' }}
          >
            Filtrele
          </h2>
        </div>

        {/* Fiyat filtresi */}
        <div className="mb-6">
          <p
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            Fiyat Aralığı
          </p>
          <ul className="space-y-2">
            {PRICE_RANGES.map((f) => (
              <li key={f.value}>
                <label
                  className="flex cursor-pointer items-center gap-2 text-sm"
                  style={{ color: 'var(--color-primary)' }}
                >
                  <input
                    type="checkbox"
                    value={f.value}
                    checked={activePriceRange === f.value}
                    onChange={(e) => handlePriceChange(f.value, e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  {f.label}
                </label>
              </li>
            ))}
          </ul>
        </div>

        {/* Stok filtresi */}
        <div>
          <p
            className="mb-3 text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            Stok Durumu
          </p>
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

        {/* Filtreleri temizle */}
        {(activePriceRange ?? inStockOnly) && (
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString())
              params.delete('fiyat')
              params.delete('stokta')
              params.delete('sayfa')
              router.push(`${pathname}?${params.toString()}`, { scroll: false })
            }}
            className="mt-4 text-xs underline"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            Filtreleri temizle
          </button>
        )}
      </div>
    </aside>
  )
}
