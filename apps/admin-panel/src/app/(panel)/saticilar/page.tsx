import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createSellerRepository } from '@hanuja/api/repositories/seller.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Satıcılar' }

const STATUS_MAP: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  active: { label: 'Aktif', variant: 'success' },
  pending: { label: 'Onay Bekliyor', variant: 'warning' },
  suspended: { label: 'Askıya Alındı', variant: 'destructive' },
  rejected: { label: 'Reddedildi', variant: 'secondary' },
}

export default async function SellersPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const repo = createSellerRepository(prisma)
  const sellers = await repo.listForAdmin({ skip: 0, take: 100 })

  const sellerIds = sellers.map((s) => s.id)

  // Pending payout: sum of netAmount for hold_active + payout_blocked payouts
  const payoutAgg = await prisma.payout.groupBy({
    by: ['sellerId'],
    where: {
      sellerId: { in: sellerIds },
      status: { in: ['hold_active', 'payout_blocked', 'payout_ready', 'payout_scheduled'] },
    },
    _sum: { netAmount: true },
  })
  const payoutMap = new Map(payoutAgg.map((p) => [p.sellerId, Number(p._sum.netAmount ?? 0)]))

  // Balance: net sum of all ledger entries per seller
  const balanceAgg = await prisma.sellerLedgerEntry.groupBy({
    by: ['sellerId'],
    where: { sellerId: { in: sellerIds } },
    _sum: { amount: true },
  })
  const balanceMap = new Map(balanceAgg.map((b) => [b.sellerId, Number(b._sum.amount ?? 0)]))

  // Product counts
  const productCounts = await prisma.product.groupBy({
    by: ['sellerId'],
    where: { sellerId: { in: sellerIds } },
    _count: { id: true },
  })
  const productCountMap = new Map(productCounts.map((p) => [p.sellerId, p._count.id]))

  return (
    <div className="space-y-6">
      <PageHeader title="Satıcılar" description={`${sellers.length} satıcı`} />

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {sellers.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Satıcı yok.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Satıcı', 'Şehir', 'Ürün', 'Bekleyen Hakediş', 'Bakiye', 'Durum', ''].map((h) => (
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
                          className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
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
                      {pendingPayout > 0 ? `₺${pendingPayout.toLocaleString('tr-TR')}` : '—'}
                    </td>
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: isNegative ? 'var(--color-destructive)' : 'var(--color-muted-fg)' }}
                    >
                      {isNegative
                        ? `-₺${Math.abs(balance).toLocaleString('tr-TR')}`
                        : balance > 0
                        ? `₺${balance.toLocaleString('tr-TR')}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
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
    </div>
  )
}
