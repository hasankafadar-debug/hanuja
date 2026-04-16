import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader, StatCard } from '@hanuja/ui'
import { Wallet, Clock, Lock, CheckCircle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { ReleasePayoutButton } from '@/components/release-payout-button'
import { createPayoutService } from '@hanuja/api/services/payout.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Hakedişler' }

export default async function PayoutsAdminPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const svc = createPayoutService({ prisma })

  const [payouts, summary] = await Promise.all([
    svc.listForAdmin({ skip: 0, take: 50 }),
    Promise.all([
      prisma.payout.aggregate({ where: { status: 'payout_ready' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'hold_active' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'payout_blocked' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'payout_paid' }, _sum: { netAmount: true } }),
    ]),
  ])

  const [readyAgg, holdAgg, blockedAgg, paidAgg] = summary
  const fmt = (n: number) => `₺${n.toLocaleString('tr-TR')}`

  type PayoutRow = {
    id: string
    orderId: string
    sellerId: string
    status: string
    netAmount: { toNumber(): number } | number
    holdUntil: Date | null
    blockedReason: string | null
    createdAt: Date
    seller: { profile: { storeName: string } | null } | null
    order: { deliveryConfirmedAt: Date | null } | null
  }

  const rows = payouts as unknown as PayoutRow[]

  return (
    <div className="space-y-8">
      <PageHeader title="Hakedişler" description="Satıcı hakediş durumları ve ödemeler" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Ödeme Hazır"
          value={fmt(Number(readyAgg._sum.netAmount ?? 0))}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <StatCard
          title="Beklemede (30 gün)"
          value={fmt(Number(holdAgg._sum.netAmount ?? 0))}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Bloke"
          value={fmt(Number(blockedAgg._sum.netAmount ?? 0))}
          icon={<Lock className="h-5 w-5" />}
        />
        <StatCard
          title="Bu Ay Ödenen"
          value={fmt(Number(paidAgg._sum.netAmount ?? 0))}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Hakediş kaydı yok.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Satıcı', 'Sipariş', 'Net Tutar', 'Teslim Onayı', 'Ödeme Tarihi', 'Blok Sebebi', 'Durum', ''].map((h) => (
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
              {rows.map((p) => {
                const amount = typeof p.netAmount === 'number' ? p.netAmount : p.netAmount.toNumber()
                const storeName = p.seller?.profile?.storeName ?? p.sellerId.slice(0, 8)
                const deliveryDate = p.order?.deliveryConfirmedAt
                  ? new Date(p.order.deliveryConfirmedAt).toLocaleDateString('tr-TR', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })
                  : '—'
                const readyAt = p.holdUntil
                  ? new Date(p.holdUntil).toLocaleDateString('tr-TR', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })
                  : '—'

                return (
                  <tr
                    key={p.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/saticilar/${p.sellerId}`}
                        className="hover:underline font-medium"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {storeName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${p.orderId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {p.orderId.slice(-8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      ₺{amount.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {deliveryDate}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {readyAt}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-destructive)' }}>
                      {p.blockedReason ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.status as never} />
                    </td>
                    <td className="px-4 py-3">
                      {p.status === 'payout_ready' && (
                        <ReleasePayoutButton payoutId={p.id} />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
