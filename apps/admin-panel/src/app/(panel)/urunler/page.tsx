import type { Metadata } from 'next'
import type { ProductStatus } from '@prisma/client'
import Link from 'next/link'
import { Badge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { ProductModerationActions } from '@/components/product-moderation-actions'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'
import { buildSuggestedRejectReason, parseModerationFindings } from '@/lib/product-moderation'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ürün Moderasyon' }

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  pending_review: { label: 'İnceleme bekliyor', variant: 'warning' },
  published: { label: 'Yayında', variant: 'success' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
  draft: { label: 'Taslak', variant: 'secondary' },
  unlisted: { label: 'Yayından kaldırıldı', variant: 'secondary' },
}

const STATUS_OPTIONS = [
  { value: 'pending_review', label: 'İnceleme bekliyor' },
  { value: 'published', label: 'Yayında' },
  { value: 'rejected', label: 'Reddedildi' },
  { value: 'draft', label: 'Taslak' },
  { value: 'unlisted', label: 'Yayından kaldırıldı' },
]

export default async function ProductModerationPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, {
    pageSize: 20,
    status: ['pending_review'],
  })

  const prisma = createPrismaForRoute()
  const catalog = createCatalogService({ prisma })
  const result = await catalog.listProductsForAdmin({
    ...(params.status.length > 0 ? { status: params.status as ProductStatus[] } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))
  const pendingCount = params.status.includes('pending_review')
    ? result.total
    : await prisma.product.count({ where: { status: 'pending_review' } })

  return (
    <div className="space-y-6">
      <PageHeader title="Ürün Moderasyon" description={`${pendingCount} onay bekliyor`} />

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Ürün, kategori veya satıcı ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        sellerValue={params.seller}
        sellerPlaceholder="Satıcı ID"
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showSellerFilter
      />

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Ürün', 'Satıcı', 'Kategori', 'Gönderim', 'Durum', ''].map((heading) => (
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
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Ürün bulunamadı.
                </td>
              </tr>
            )}
            {result.rows.map((product) => {
              const statusInfo = STATUS_MAP[product.status]
              const sellerName = product.seller?.displayName ?? '—'
              const categoryName = product.category?.name ?? '—'
              const findings = parseModerationFindings(product.moderationFindings)
              return (
                <tr
                  key={product.id}
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                    <Link href={`/urunler/${product.id}`} className="hover:underline">
                      {product.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {sellerName}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {categoryName}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {product.createdAt.toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    {statusInfo && <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/urunler/${product.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        İncele →
                      </Link>
                      {product.status === 'pending_review' && (
                        <ProductModerationActions
                          productId={product.id}
                          defaultRejectReason={buildSuggestedRejectReason(findings)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
