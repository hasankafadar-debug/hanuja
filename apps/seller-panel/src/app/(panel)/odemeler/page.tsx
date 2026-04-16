import type { Metadata } from 'next'
import { StatCard, PageHeader, StatusBadge } from '@hanuja/ui'
import { Wallet, Clock, Lock, CheckCircle } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ödemeler & Hakediş' }

export default async function PayoutsPage() {
  const { seller } = await getSellerFromSession()

  const payoutRepo = createPayoutRepository(createPrismaForRoute())
  const [payouts, summary] = await Promise.all([
    payoutRepo.listBySeller({ sellerId: seller.id, skip: 0, take: 50 }),
    payoutRepo.getSummaryBySeller(seller.id),
  ])

  type PayoutRow = {
    id: string
    orderId: string
    grossAmount: { toNumber(): number } | number
    commissionAmount: { toNumber(): number } | number
    netAmount: { toNumber(): number } | number
    status: string
    holdUntil: Date | null
    paidAt: Date | null
    createdAt: Date
  }

  const rows = payouts as unknown as PayoutRow[]

  // Build summary totals from grouped data
  const toNum = (v: unknown) => {
    if (v === null || v === undefined) return 0
    if (typeof v === 'object' && 'toNumber' in (v as object)) return (v as { toNumber(): number }).toNumber()
    return Number(v)
  }

  type SummaryRow = { status: string; _sum: { netAmount: unknown } }
  const summaryTyped = summary as unknown as SummaryRow[]

  const holdAmount = summaryTyped.filter((s) => s.status === 'hold_active').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)
  const readyAmount = summaryTyped.filter((s) => s.status === 'payout_ready').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)
  const paidAmount = summaryTyped.filter((s) => s.status === 'payout_paid').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)
  const blockedAmount = summaryTyped.filter((s) => s.status === 'payout_blocked').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)

  const balance = holdAmount + readyAmount - blockedAmount

  return (
    <div className="space-y-8">
      <PageHeader title="Ödemeler & Hakediş" description="Satış gelirleri ve kesintiler" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Bekliyor (30 gün)" value={`₺${holdAmount.toLocaleString('tr-TR')}`} icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Ödeme Hazır" value={`₺${readyAmount.toLocaleString('tr-TR')}`} icon={<CheckCircle className="h-5 w-5" />} />
        <StatCard title="Toplam Ödendi" value={`₺${paidAmount.toLocaleString('tr-TR')}`} icon={<Wallet className="h-5 w-5" />} />
        <StatCard
          title="Güncel Bakiye"
          value={`${balance < 0 ? '-' : ''}₺${Math.abs(balance).toLocaleString('tr-TR')}`}
          icon={<Lock className="h-5 w-5" />}
        />
      </div>

      {/* Explanation banner */}
      <div
        className="rounded-xl p-4 text-sm"
        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Ödeme Takvimi:</strong>{' '}
        Teslimat onayından itibaren 30 gün sonra ödeme yapılır. Açık iade veya uyuşmazlık durumunda ödeme bloke edilebilir.
      </div>

      {/* Ledger table */}
      <section>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>Cari Hesap</h2>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz hakediş kaydı yok.
          </p>
        ) : (
          <div
            className="rounded-xl border overflow-x-auto"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <table className="w-full text-sm whitespace-nowrap">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Sipariş', 'Brüt', 'Komisyon', 'Net', 'Bloke Bitiş', 'Durum'].map((h) => (
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
                {rows.map((payout) => {
                  const gross = toNum(payout.grossAmount)
                  const commission = toNum(payout.commissionAmount)
                  const net = toNum(payout.netAmount)
                  const holdUntilStr = payout.holdUntil
                    ? new Date(payout.holdUntil).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'
                  return (
                    <tr key={payout.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3 font-medium font-mono text-xs" style={{ color: 'var(--color-primary)' }}>
                        #{payout.orderId.slice(-8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {gross > 0 ? `₺${gross.toLocaleString('tr-TR')}` : '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {commission > 0 ? `-₺${commission.toLocaleString('tr-TR')}` : '—'}
                      </td>
                      <td
                        className="px-4 py-3 font-medium"
                        style={{ color: net < 0 ? 'var(--color-destructive)' : 'var(--color-primary)' }}
                      >
                        {net >= 0 ? `₺${net.toLocaleString('tr-TR')}` : `-₺${Math.abs(net).toLocaleString('tr-TR')}`}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{holdUntilStr}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={payout.status as Parameters<typeof StatusBadge>[0]['status']} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
