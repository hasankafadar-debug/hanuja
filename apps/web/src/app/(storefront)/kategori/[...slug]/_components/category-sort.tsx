'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

const SORT_OPTIONS = [
  { value: 'newest', label: 'Öne Çıkanlar' },
  { value: 'favorited', label: 'En Çok Favorilenenler' },
  { value: 'price-asc', label: 'Fiyat: Düşük → Yüksek' },
  { value: 'price-desc', label: 'Fiyat: Yüksek → Düşük' },
] as const

interface CategorySortProps {
  currentSort?: string
  totalProducts: number
}

export function CategorySort({ currentSort, totalProducts }: CategorySortProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleSortChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'newest') {
      params.delete('siralama')
    } else {
      params.set('siralama', value)
    }
    params.delete('sayfa')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div
      className="flex items-center justify-between rounded-lg border px-4 py-2"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
        <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
          {totalProducts}
        </span>{' '}
        ürün
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor="sort" className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Sırala:
        </label>
        <select
          id="sort"
          value={currentSort ?? 'newest'}
          onChange={(e) => handleSortChange(e.target.value)}
          className="rounded-md border py-1 pl-2 pr-6 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-primary)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
