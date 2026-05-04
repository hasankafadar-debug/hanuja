import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { maskIban } from '@hanuja/security'
import { BankDetailReviewTable } from './_components/bank-detail-review-table'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Banka Değişiklikleri',
}

const STATUS_OPTIONS = [
  { value: 'PENDING_ACTIVATION', label: 'Onay bekliyor' },
  { value: 'BLOCKED', label: 'Bloklu' },
]

export default async function BankDetailChangesPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()
  const prisma = createPrismaForRoute()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const dateRange = buildDateRange(params)
  const where = {
    AND: [
      {
        OR: [
          {
            status: 'PENDING_ACTIVATION' as const,
            isVerified: false,
          },
          {
            status: 'BLOCKED' as const,
          },
        ],
      },
      ...(params.status[0]
        ? [
            {
              status: params.status[0] as 'PENDING_ACTIVATION' | 'BLOCKED',
            },
          ]
        : []),
      ...(params.q
        ? [
            {
              OR: [
                { bankName: { contains: params.q, mode: 'insensitive' as const } },
                { seller: { displayName: { contains: params.q, mode: 'insensitive' as const } } },
              ],
            },
          ]
        : []),
      ...(params.seller ? [{ sellerId: params.seller }] : []),
      ...(dateRange.from || dateRange.to
        ? [
            {
              createdAt: {
                ...(dateRange.from ? { gte: dateRange.from } : {}),
                ...(dateRange.to ? { lte: dateRange.to } : {}),
              },
            },
          ]
        : []),
    ],
  }

  const [rows, total] = await Promise.all([
    prisma.sellerBankDetail.findMany({
      where,
      include: {
        seller: true,
      },
      orderBy: { createdAt: 'desc' },
      ...getPagination(params),
    }),
    prisma.sellerBankDetail.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Banka Değişiklikleri"
        description={`${total} bekleyen veya bloklu kayıt`}
      />

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Satıcı veya banka ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        sellerValue={params.seller}
        sellerPlaceholder="Satıcı ID"
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showSellerFilter
      />

      <BankDetailReviewTable
        rows={rows.map((row) => ({
          id: row.id,
          sellerName: row.seller.displayName,
          ibanMasked: maskIban(row.iban),
          previousIbanMasked: row.previousIbanMasked ?? null,
          bankName: row.bankName,
          status: row.status,
          activatesAt: row.activatesAt?.toISOString() ?? null,
          flags: row.flags ?? null,
        }))}
      />

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
