'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge, Button, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { formatMoney } from '@hanuja/security/format-money'
import { Package } from 'lucide-react'
import InlineCell from './inline-cell'

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  published: { label: 'Aktif', variant: 'success' },
  draft: { label: 'Taslak', variant: 'secondary' },
  pending_review: { label: 'Incelemede', variant: 'warning' },
  unlisted: { label: 'Yayindan Kaldirildi', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
}

interface ProductRow {
  id: string
  name: string
  status: string
  price: { toNumber(): number } | number
  stockQuantity: number | null
  images: Array<{ url: string }>
}

export default function ProductsTableClient({ initialRows }: { initialRows: ProductRow[] }) {
  const [rows, setRows] = useState(
    initialRows.map((product) => ({
      ...product,
      price: typeof product.price === 'object' ? product.price.toNumber() : Number(product.price),
      stockQuantity: product.stockQuantity ?? 0,
    })),
  )
  const [error, setError] = useState<string | null>(null)

  async function patchProduct(productId: string, patch: { price?: number; stockQuantity?: number }) {
    setError(null)
    const previousRows = rows
    setRows((current) =>
      current.map((row) => (row.id === productId ? { ...row, ...patch } : row)),
    )

    try {
      const response = await fetch(`/api/seller/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error ?? 'Guncelleme basarisiz oldu.')
      }
    } catch (err) {
      setRows(previousRows)
      setError(err instanceof Error ? err.message : 'Guncelleme basarisiz oldu.')
      throw err
    }
  }

  return (
    <>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--color-destructive)' }}>
          {error}
        </p>
      ) : null}
      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Urun', 'Fiyat', 'Stok', 'Durum', ''].map((heading) => (
                <th
                  key={heading}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => {
              const statusInfo = STATUS_MAP[product.status] ?? { label: product.status, variant: 'secondary' as const }
              const imageUrl = product.images?.[0]?.url
                ? normalizeMediaDisplayUrl(product.images[0].url)
                : null
              const useUnoptimizedImage = Boolean(imageUrl?.startsWith('/api/media/fetch?'))

              return (
                <tr
                  key={product.id}
                  className="border-t transition-colors hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                      >
                        {imageUrl ? (
                          <Image
                            src={imageUrl}
                            alt={product.name}
                            fill
                            className="object-cover"
                            unoptimized={useUnoptimizedImage}
                          />
                        ) : (
                          <Package className="h-4 w-4" />
                        )}
                      </div>
                      <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                        {product.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                    <InlineCell
                      value={product.price}
                      min={0}
                      step={0.01}
                      onSubmit={(value) => patchProduct(product.id, { price: value })}
                    />
                    <span className="ml-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      ({formatMoney(product.price)})
                    </span>
                  </td>
                  <td
                    className="px-4 py-3"
                    style={{
                      color: product.stockQuantity === 0 ? 'var(--color-destructive)' : 'var(--color-muted-fg)',
                    }}
                  >
                    <InlineCell
                      value={product.stockQuantity}
                      min={0}
                      onSubmit={(value) => patchProduct(product.id, { stockQuantity: Math.floor(value) })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/urunler/${product.id}`}>Duzenle</Link>
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
