import type { Metadata } from 'next'
import Link from 'next/link'
import { StatCard, PageHeader } from '@hanuja/ui'
import { TrendingUp, Wallet, AlertOctagon, RotateCcw, CreditCard, AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAnalyticsService } from '@hanuja/api/services/admin-analytics.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { getPagination, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Finans Özeti' }

export default async function FinanceSummaryPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const prisma = createPrismaForRoute()
  const analytics = createAdminAnalyticsService({ prisma })

  const [stats, sellerSummariesResult] = await Promise.all([
    analytics.getDashboardStats(),
    analytics.getSellerFinanceSummaries({
      ...(params.q ? { query: params.q } : {}),
      ...getPagination(params),
    }),
  ])

  const [commissionTotal, penaltyTotal, refundTotal, collectedTotal] = await Promise.all([
    prisma.payout.aggregate({ _sum: { commissionAmount: true } }),
    prisma.penalty.aggregate({ where: { status: 'applied' }, _sum: { penaltyAmount: true } }),
    prisma.payment.aggregate({ where: { status: 'refunded' }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'confirmed' }, _sum: { amount: true } }),
  ])

  const fmt = (n: number) =>
    n >= 1000 ? `₺${(n / 1000).toFixed(1)}K` : `₺${n.toLocaleString('tr-TR')}`

  const totalCollected = Number(collectedTotal._sum.amount ?? 0)
  const totalCommission = Number(commissionTotal._sum.commissionAmount ?? 0)
  const totalPenalties = Number(penaltyTotal._sum.penaltyAmount ?? 0)
  const totalRefunds = Number(refundTotal._sum.amount ?? 0)
  const totalPaid = stats.payouts.pendingPayoutTotal + stats.payouts.payoutReadyTotal
  const totalPages = Math.max(1, Math.ceil(sellerSummariesResult.total / params.pageSize))

  return (
    <div className="space-y-8" data-testid="admin-finance-page">
      <PageHeader title="Finans Özeti" description="Platform geneli finansal durum" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard title="Toplam Tahsilat" value={fmt(totalCollected)} icon={<CreditCard className="h-5 w-5" />} />
        <StatCard title="Komisyon Geliri" value={fmt(totalCommission)} icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard title="Satıcı Ödemeleri" value={fmt(totalPaid)} icon={<Wallet className="h-5 w-5" />} />
        <StatCard title="Toplam Ceza" value={fmt(totalPenalties)} icon={<AlertOctagon className="h-5 w-5" />} />
        <StatCard title="İade Tutarı" value={fmt(totalRefunds)} icon={<RotateCcw className="h-5 w-5" />} />
      </div>

      <section className="space-y-4">
        <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
          Satıcı Bazlı Finansal Durum
        </h2>

        <AdminListControls
          searchValue={params.q}
          searchPlaceholder="Satıcı ara"
          pageSize={params.pageSize}
          showDateRange={false}
        />

        <div
          className="overflow-x-auto rounded-xl border"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          {sellerSummariesResult.rows.length === 0 ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Satıcı finansal verisi yok.
            </p>
          ) : (
            <table className="w-full whitespace-nowrap text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Satıcı', 'Bekleyen', 'Hazır', 'Ödenen', 'Komisyon', 'Ceza', 'Bakiye'].map((heading) => (
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
                {sellerSummariesResult.rows.map((summary) => (
                  <tr
                    key={summary.sellerId}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: summary.isNegativeBalance ? '#fff5f5' : undefined,
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {summary.isNegativeBalance && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-destructive)' }} />
                        )}
                        <Link
                          href={`/saticilar/${summary.sellerId}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {summary.storeName}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{summary.pendingPayout.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-success)' }}>
                      ₺{summary.payoutReady.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{summary.paidTotal.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{summary.commissionDeducted.toLocaleString('tr-TR')}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{ color: summary.penaltyDeducted > 0 ? 'var(--color-destructive)' : 'var(--color-muted-fg)' }}
                    >
                      {summary.penaltyDeducted > 0 ? `₺${summary.penaltyDeducted.toLocaleString('tr-TR')}` : '—'}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold"
                      style={{ color: summary.isNegativeBalance ? 'var(--color-destructive)' : 'var(--color-primary)' }}
                    >
                      {summary.isNegativeBalance ? '-' : ''}₺{Math.abs(summary.currentBalance).toLocaleString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-end">
          <UrlPagination page={params.page} totalPages={totalPages} />
        </div>
      </section>
    </div>
  )
}
