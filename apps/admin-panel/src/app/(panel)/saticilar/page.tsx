import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { formatMoney } from '@hanuja/security'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Satıcılar' }

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  active: { label: 'Aktif', variant: 'success' },
  pending: { label: 'Onay bekliyor', variant: 'warning' },
  suspended: { label: 'Askıya alındı', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'secondary' },
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Aktif' },
  { value: 'pending', label: 'Onay bekliyor' },
  { value: 'suspended', label: 'Askıya alındı' },
  { value: 'rejected', label: 'Reddedildi' },
]

const IMPORT_PERMISSION_OPTIONS = [
  { value: 'pending', label: 'İstek bekliyor' },
  { value: 'active', label: 'İzin aktif' },
  { value: 'none', label: 'İstek yok' },
]

export default async function SellersPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })
  const importPermission =
    params.importPermission === 'pending' || params.importPermission === 'active' || params.importPermission === 'none'
      ? params.importPermission
      : undefined

  const prisma = createPrismaForRoute()
  const repo = createSellerRepository(prisma)
  const result = await repo.listForAdmin({
    ...(params.status[0] ? { status: params.status[0] as 'active' | 'pending' | 'suspended' | 'rejected' } : {}),
    ...(importPermission ? { importPermission } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  const sellers = result.rows
  const sellerIds = sellers.map((seller) => seller.id)
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))

  const [payoutAgg, balanceAgg, productCounts] = await Promise.all([
    prisma.payout.groupBy({
      by: ['sellerId'],
      where: {
        sellerId: { in: sellerIds },
        status: { in: ['hold_active', 'payout_blocked', 'payout_ready', 'payout_scheduled'] },
      },
      _sum: { netAmount: true },
    }),
    prisma.sellerLedgerEntry.groupBy({
      by: ['sellerId'],
      where: { sellerId: { in: sellerIds } },
      _sum: { amount: true },
    }),
    prisma.product.groupBy({
      by: ['sellerId'],
      where: { sellerId: { in: sellerIds } },
      _count: { id: true },
    }),
  ])

  const payoutMap = new Map(payoutAgg.map((p) => [p.sellerId, Number(p._sum.netAmount ?? 0)]))
  const balanceMap = new Map(balanceAgg.map((b) => [b.sellerId, Number(b._sum.amount ?? 0)]))
  const productCountMap = new Map(productCounts.map((p) => [p.sellerId, p._count.id]))

  return (
    <div className="space-y-6" data-testid="admin-sellers-page">
      <PageHeader title="Satıcılar" description={`${result.total} satıcı`} />

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Satıcı, şehir veya e-posta ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        importValue={params.importPermission}
        importOptions={IMPORT_PERMISSION_OPTIONS}
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
      />

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {sellers.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Satıcı yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Satıcı', 'Şehir', 'Ürün', 'Bekleyen Hakediş', 'Bakiye', 'Durum', 'Hipicon', ''].map((heading) => (
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
              {sellers.map((seller) => {
                const status = STATUS_MAP[seller.status] ?? { label: seller.status, variant: 'secondary' as const }
                const pendingPayout = payoutMap.get(seller.id) ?? 0
                const balance = balanceMap.get(seller.id) ?? 0
                const isNegative = balance < 0
                const productCount = productCountMap.get(seller.id) ?? 0

                return (
                  <tr
                    key={seller.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: 'var(--color-accent)' }}
                        >
                          {seller.displayName.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                          {seller.displayName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {seller.profile?.city ?? '—'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {productCount}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {pendingPayout > 0 ? formatMoney(pendingPayout) : '—'}
                    </td>
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: isNegative ? 'var(--color-destructive)' : 'var(--color-muted-fg)' }}
                    >
                      {balance === 0 ? '—' : formatMoney(balance)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {seller.importEnabled ? (
                        <Badge variant="success">İzin Aktif - 1 Kullanım</Badge>
                      ) : seller.importRequestedAt ? (
                        <Badge variant="warning">İstek Bekliyor</Badge>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          â€”
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/saticilar/${seller.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        İncele →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
