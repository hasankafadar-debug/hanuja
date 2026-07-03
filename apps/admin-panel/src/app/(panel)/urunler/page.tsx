import type { Metadata } from 'next'
import type { ProductStatus } from '@prisma/client'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCatalogService } from '@hanuja/api/services/catalog.service'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import {
  buildDateRange,
  getPagination,
  getPrimaryStatusValue,
  parseAdminListParams,
  type RawAdminSearchParams,
} from '@/lib/admin-list-params'
import { buildSuggestedRejectReason, parseModerationFindings } from '@/lib/product-moderation'
import { ModerationTableClient } from './_components/moderation-table-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Urun Moderasyon' }

const STATUS_OPTIONS = [
  { value: 'pending_review', label: 'Inceleme bekliyor' },
  { value: 'published', label: 'Yayinda' },
  { value: 'rejected', label: 'Reddedildi' },
  { value: 'draft', label: 'Taslak' },
  { value: 'unlisted', label: 'Yayindan kaldirildi' },
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
    ...(params.barcode ? { barcode: params.barcode } : {}),
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
      <PageHeader title="Urun Moderasyon" description={`${pendingCount} onay bekliyor`} />

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Urun, kategori veya satici ara"
        barcodeValue={params.barcode}
        barcodePlaceholder="Barkod ile ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        sellerValue={params.seller}
        sellerPlaceholder="Satici ID"
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showSellerFilter
        showBarcodeFilter
      />

      <ModerationTableClient
        rows={result.rows.map((product) => ({
          id: product.id,
          name: product.name,
          status: product.status,
          createdAt: product.createdAt,
          sellerName: product.seller?.displayName ?? '—',
          categoryName: product.category?.name ?? '—',
          defaultRejectReason: buildSuggestedRejectReason(parseModerationFindings(product.moderationFindings)),
        }))}
      />

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
