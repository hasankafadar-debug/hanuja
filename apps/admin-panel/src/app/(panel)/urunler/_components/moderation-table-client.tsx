'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge, Button } from '@hanuja/ui'
import { ProductModerationActions } from '@/components/product-moderation-actions'

type ProductRow = {
  id: string
  name: string
  modelCode: string
  status: 'pending_review' | 'published' | 'rejected' | 'draft' | 'unlisted'
  createdAt: string | Date
  sellerName: string
  categoryName: string
  defaultRejectReason: string
}

const STATUS_MAP: Record<ProductRow['status'], { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  pending_review: { label: 'Inceleme bekliyor', variant: 'warning' },
  published: { label: 'Yayinda', variant: 'success' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
  draft: { label: 'Taslak', variant: 'secondary' },
  unlisted: { label: 'Yayindan kaldirildi', variant: 'secondary' },
}

export function ModerationTableClient({ rows }: { rows: ProductRow[] }) {
  const router = useRouter()
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)

  const selectableIds = useMemo(
    () => rows.filter((row) => row.status === 'pending_review').map((row) => row.id),
    [rows],
  )
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.includes(id))

  function toggleOne(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : selectableIds)
  }

  async function handleBulkApprove() {
    if (selectedIds.length === 0) return
    const confirmed = window.confirm(`${selectedIds.length} urun onaylansin mi?`)
    if (!confirmed) return

    setBulkLoading(true)
    try {
      await Promise.allSettled(
        selectedIds.map((id) => fetch(`/api/admin/products/${id}/approve`, { method: 'POST' })),
      )
      setSelectedIds([])
      router.refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <div
      className="overflow-x-auto rounded-xl border"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-primary)' }}>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={selectableIds.length === 0 || bulkLoading}
          />
          Tumunu Sec
        </label>
        <Button size="sm" onClick={handleBulkApprove} disabled={selectedIds.length === 0 || bulkLoading}>
          {bulkLoading ? 'Onaylaniyor...' : `Secilenleri Onayla (${selectedIds.length})`}
        </Button>
      </div>

      <table className="w-full whitespace-nowrap text-sm">
        <thead style={{ backgroundColor: 'var(--color-muted)' }}>
          <tr>
            {['', 'Urun', 'Satici', 'Kategori', 'Gonderim', 'Durum', ''].map((heading) => (
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
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Urun bulunamadi.
              </td>
            </tr>
          ) : null}

          {rows.map((product) => (
            <tr
              key={product.id}
              className="border-t hover:bg-[var(--color-muted)]"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <td className="px-4 py-3">
                {product.status === 'pending_review' ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(product.id)}
                    onChange={() => toggleOne(product.id)}
                    disabled={bulkLoading}
                  />
                ) : null}
              </td>
              <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                <Link href={`/urunler/${product.id}`} className="hover:underline">
                  {product.name}
                </Link>
                <p className="mt-0.5 text-xs font-normal" style={{ color: 'var(--color-muted-fg)' }}>
                  Model Kodu: {product.modelCode}
                </p>
              </td>
              <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                {product.sellerName}
              </td>
              <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                {product.categoryName}
              </td>
              <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                {new Date(product.createdAt).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </td>
              <td className="px-4 py-3">
                <Badge variant={STATUS_MAP[product.status].variant}>{STATUS_MAP[product.status].label}</Badge>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/urunler/${product.id}`}
                    className="text-xs hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    Incele →
                  </Link>
                  <ProductModerationActions
                    productId={product.id}
                    status={product.status}
                    defaultRejectReason={product.defaultRejectReason}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
