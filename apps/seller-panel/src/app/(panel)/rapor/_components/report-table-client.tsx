'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { ChevronDown, ChevronUp, ChevronsUpDown, Package } from 'lucide-react'
import { normalizeMediaDisplayUrl } from '@hanuja/ui'
import type { SellerProductReportRow } from '@hanuja/api/services/product-analytics.service'

type SortKey = keyof Omit<SellerProductReportRow, 'productId' | 'slug' | 'imageUrl'>
type SortDir = 'asc' | 'desc' | null

interface Props {
  rows: SellerProductReportRow[]
  webUrl: string
}

function buildProductHref(webUrl: string, slug: string) {
  return `${webUrl}/urun/${slug}`
}

function formatRate(rate: number | null) {
  if (rate === null) return '-'
  return `%${(rate * 100).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Urun' },
  { key: 'favoritedCustomerCount', label: 'Favorileyen Musteri' },
  { key: 'cartCustomerCount', label: 'Sepete Ekleyen Musteri' },
  { key: 'viewedCustomerCount', label: 'Goruntuleyen Musteri' },
  { key: 'convertedCustomerCount', label: 'Satisa Donen Musteri' },
  { key: 'conversionRate', label: 'Donusum' },
]

export function ReportTableClient({ rows, webUrl }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)

  function handleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('asc')
    } else if (sortDir === 'asc') {
      setSortDir('desc')
    } else {
      setSortKey(null)
      setSortDir(null)
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const dir = sortDir === 'asc' ? 1 : -1
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv), 'tr') * dir
    })
  }, [rows, sortKey, sortDir])

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[58rem] w-full text-sm">
        <thead style={{ backgroundColor: 'var(--color-muted)' }}>
          <tr>
            {COLUMNS.map(({ key, label }) => {
              const active = sortKey === key
              const Icon = active
                ? sortDir === 'asc'
                  ? ChevronUp
                  : ChevronDown
                : ChevronsUpDown
              return (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide cursor-pointer select-none"
                  style={{ color: active ? 'var(--color-primary)' : 'var(--color-muted-fg)' }}
                >
                  <span className="inline-flex items-center gap-1">
                    {label}
                    <Icon className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const imageUrl = row.imageUrl ? normalizeMediaDisplayUrl(row.imageUrl) : null
            const useUnoptimizedImage = Boolean(imageUrl?.startsWith('/api/media/fetch?'))

            return (
              <tr
                key={row.productId}
                data-testid={`report-row-${row.slug}`}
                className="border-t"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                      style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                    >
                      {imageUrl ? (
                        <Image
                          src={imageUrl}
                          alt={row.name}
                          fill
                          sizes="44px"
                          className="object-cover"
                          unoptimized={useUnoptimizedImage}
                        />
                      ) : (
                        <Package className="h-4 w-4" />
                      )}
                    </div>
                    <a
                      href={buildProductHref(webUrl, row.slug)}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {row.name}
                    </a>
                  </div>
                </td>
                <td
                  data-testid="report-favorited"
                  className="px-4 py-3 tabular-nums"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {row.favoritedCustomerCount}
                </td>
                <td
                  data-testid="report-cart"
                  className="px-4 py-3 tabular-nums"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {row.cartCustomerCount}
                </td>
                <td
                  data-testid="report-viewed"
                  className="px-4 py-3 tabular-nums font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {row.viewedCustomerCount}
                </td>
                <td
                  data-testid="report-converted"
                  className="px-4 py-3 tabular-nums"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {row.convertedCustomerCount}
                </td>
                <td
                  data-testid="report-conversion"
                  className="px-4 py-3 tabular-nums font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {formatRate(row.conversionRate)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
