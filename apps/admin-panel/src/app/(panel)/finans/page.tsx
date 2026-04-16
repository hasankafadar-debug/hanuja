import type { Metadata } from 'next'
import Link from 'next/link'
import { StatCard, PageHeader } from '@hanuja/ui'
import { TrendingUp, Wallet, AlertOctagon, RotateCcw, CreditCard, AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAnalyticsService } from '@hanuja/api/services/admin-analytics.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Finans Özeti' }

export default async function FinanceSummaryPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const analytics = createAdminAnalyticsService({ prisma })

  const [stats, sellerSummaries] = await Promise.all([
    analytics.getDashboardStats(),
    analytics.getSellerFinanceSummaries({ skip: 0, take: 50 }),
  ])

  // Platform totals from payout/penalty aggregations
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

  return (
    <div className="space-y-8">
      <PageHeader title="Finans Özeti" description="Platform geneli finansal durum" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          title="Toplam Tahsilat"
          value={fmt(totalCollected)}
          icon={<CreditCard className="h-5 w-5" />}
        />
        <StatCard
          title="Komisyon Geliri"
          value={fmt(totalCommission)}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Satıcı Ödemeleri"
          value={fmt(totalPaid)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <StatCard
          title="Toplam Ceza"
          value={fmt(totalPenalties)}
          icon={<AlertOctagon className="h-5 w-5" />}
        />
        <StatCard
          title="İade Tutarı"
          value={fmt(totalRefunds)}
          icon={<RotateCcw className="h-5 w-5" />}
        />
      </div>

      {/* Seller finance summary table */}
      <section>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Satıcı Bazlı Finansal Durum
        </h2>
        <div
          className="rounded-xl border overflow-x-auto"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          {sellerSummaries.length === 0 ? (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Satıcı finansal verisi yok.
            </p>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Satıcı', 'Bekleyen', 'Hazır', 'Ödenen', 'Komisyon', 'Ceza', 'Bakiye'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sellerSummaries.map((s) => (
                  <tr
                    key={s.sellerId}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: s.isNegativeBalance ? '#fff5f5' : undefined,
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {s.isNegativeBalance && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-destructive)' }} />
                        )}
                        <Link
                          href={`/saticilar/${s.sellerId}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {s.storeName}
                        </Link>
                      </div>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{s.pendingPayout.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-success)' }}>
                      ₺{s.payoutReady.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{s.paidTotal.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      ₺{s.commissionDeducted.toLocaleString('tr-TR')}
                    </td>
                    <td
                      className="px-4 py-3"
                      style={{ color: s.penaltyDeducted > 0 ? 'var(--color-destructive)' : 'var(--color-muted-fg)' }}
                    >
                      {s.penaltyDeducted > 0 ? `₺${s.penaltyDeducted.toLocaleString('tr-TR')}` : '—'}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold"
                      style={{ color: s.isNegativeBalance ? 'var(--color-destructive)' : 'var(--color-primary)' }}
                    >
                      {s.isNegativeBalance ? `-` : ''}₺{Math.abs(s.currentBalance).toLocaleString('tr-TR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
