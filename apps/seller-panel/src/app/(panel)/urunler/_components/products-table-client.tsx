'use client'

import { Fragment, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Badge, Button, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { formatMoney } from '@hanuja/security/format-money'
import { ChevronDown, ChevronRight, Package } from 'lucide-react'
import InlineCell from './inline-cell'

const STATUS_MAP: Record<
  string,
  {
    label: string
    variant: 'success' | 'warning' | 'secondary' | 'destructive'
  }
> = {
  published: { label: 'Aktif', variant: 'success' },
  draft: { label: 'Taslak', variant: 'secondary' },
  pending_review: { label: 'Incelemede', variant: 'warning' },
  unlisted: { label: 'Yayindan Kaldirildi', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
}

interface ProductRow {
  id: string
  name: string
  modelCode: string
  status: string
  price: { toNumber(): number } | number
  stockQuantity: number | null
  images: Array<{ url: string }>
  variants: Array<{
    id: string
    name: string
    barcode: string
    price: number | null
    stockQuantity: number
    options: Record<string, string>
  }>
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
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(() => new Set())

  async function patchProduct(productId: string, patch: { price?: number; stockQuantity?: number }) {
    setError(null)
    const previousRows = rows
    setRows((current) => current.map((row) => (row.id === productId ? { ...row, ...patch } : row)))

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

  async function patchVariant(productId: string, variantId: string, patch: { price?: number; stockQuantity?: number }) {
    setError(null)

    try {
      const response = await fetch(`/api/seller/products/${productId}/variants/${variantId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(body.error ?? 'Varyasyon guncellenemedi.')
      }

      const updatedVariant = body.variant as {
        id: string
        price: number | null
        stockQuantity: number
      }
      const updatedProduct = body.product as { stockQuantity: number }

      setRows((current) =>
        current.map((row) =>
          row.id === productId
            ? {
                ...row,
                stockQuantity: updatedProduct.stockQuantity,
                variants: row.variants.map((variant) =>
                  variant.id === variantId
                    ? {
                        ...variant,
                        price: updatedVariant.price,
                        stockQuantity: updatedVariant.stockQuantity,
                      }
                    : variant,
                ),
              }
            : row,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Varyasyon guncellenemedi.')
      throw err
    }
  }

  function toggleVariants(productId: string) {
    setExpandedProductIds((current) => {
      const next = new Set(current)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
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
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <table className="w-full text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Urun', 'Fiyat', 'Stok', 'Durum', ''].map((heading) => (
                <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => {
              const statusInfo = STATUS_MAP[product.status] ?? {
                label: product.status,
                variant: 'secondary' as const,
              }
              const imageUrl = product.images?.[0]?.url ? normalizeMediaDisplayUrl(product.images[0].url) : null
              const useUnoptimizedImage = Boolean(imageUrl?.startsWith('/api/media/fetch?'))
              const hasVariants = product.variants.length > 0
              const variantsExpanded = expandedProductIds.has(product.id)

              return (
                <Fragment key={product.id}>
                  <tr className="border-t transition-colors hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                          style={{
                            backgroundColor: 'var(--color-muted)',
                            color: 'var(--color-muted-fg)',
                          }}
                        >
                          {imageUrl ? <Image src={imageUrl} alt={product.name} fill className="object-cover" unoptimized={useUnoptimizedImage} /> : <Package className="h-4 w-4" />}
                        </div>
                        <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                          {product.name}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          Model Kodu: {product.modelCode}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      <InlineCell value={product.price} min={0} step={0.01} onSubmit={(value) => patchProduct(product.id, { price: value })} />
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
                      {hasVariants ? (
                        <button
                          type="button"
                          aria-expanded={variantsExpanded}
                          aria-label={`${product.name} varyasyonlarini ${variantsExpanded ? 'kapat' : 'ac'}`}
                          onClick={() => toggleVariants(product.id)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--color-muted)]"
                        >
                          {variantsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span>{product.stockQuantity}</span>
                          <span className="text-xs">({product.variants.length} varyasyon)</span>
                        </button>
                      ) : (
                        <InlineCell
                          value={product.stockQuantity}
                          min={0}
                          onSubmit={(value) =>
                            patchProduct(product.id, {
                              stockQuantity: Math.floor(value),
                            })
                          }
                        />
                      )}
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

                  {variantsExpanded
                    ? product.variants.map((variant) => (
                        <tr
                          key={variant.id}
                          className="border-t"
                          style={{
                            borderColor: 'var(--color-border)',
                            backgroundColor: 'var(--color-muted)',
                          }}
                        >
                          <td className="py-3 pl-16 pr-4">
                            <div className="space-y-0.5">
                              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                                {variant.name}
                              </p>
                              <p className="font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                Barkod: {variant.barcode}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                            <InlineCell
                              value={variant.price ?? product.price}
                              min={0.01}
                              step={0.01}
                              onSubmit={(value) =>
                                patchVariant(product.id, variant.id, {
                                  price: value,
                                })
                              }
                            />
                          </td>
                          <td
                            className="px-4 py-3"
                            style={{
                              color: variant.stockQuantity === 0 ? 'var(--color-destructive)' : 'var(--color-muted-fg)',
                            }}
                          >
                            <InlineCell
                              value={variant.stockQuantity}
                              min={0}
                              onSubmit={(value) =>
                                patchVariant(product.id, variant.id, {
                                  stockQuantity: Math.floor(value),
                                })
                              }
                            />
                          </td>
                          <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                            Alt varyasyon
                          </td>
                          <td />
                        </tr>
                      ))
                    : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
