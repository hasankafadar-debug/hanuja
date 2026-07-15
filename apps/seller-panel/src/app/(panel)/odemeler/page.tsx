import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, PageHeader, StatCard, StatusBadge } from '@hanuja/ui'
import { CheckCircle, Clock, Download, Lock, Wallet } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createSellerLedgerRepository } from '@hanuja/api/repositories/seller-ledger.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { formatMoney } from '@hanuja/security'
import { holdDaysRemainingLabel, formatTrDate, payoutStatusDisplay } from './_lib/payout-display'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ödemeler & Hakediş' }

export default async function PayoutsPage() {
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const prisma = createPrismaForRoute()
  const payoutRepo = createPayoutRepository(prisma)
  const sellerLedgerRepo = createSellerLedgerRepository(prisma)
  const [payouts, summary, penaltyDeductedDecimal] = await Promise.all([
    payoutRepo.listBySeller({ sellerId: seller.id, skip: 0, take: 50 }),
    payoutRepo.getSummaryBySeller(seller.id),
    sellerLedgerRepo.getPenaltyDeducted(seller.id),
  ])

  type PayoutRow = {
    id: string
    orderId: string
    order: { id: string; publicNumber: number | null } | null
    grossAmount: { toNumber(): number } | number
    commissionAmount: { toNumber(): number } | number
    netAmount: { toNumber(): number } | number
    status: string
    holdStartedAt: Date | null
    holdUntil: Date | null
  }

  type SummaryRow = { status: string; _sum: { netAmount: unknown } }

  const rows = payouts as unknown as PayoutRow[]
  const summaryRows = summary as unknown as SummaryRow[]

  const toNum = (value: unknown) => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'object' && 'toNumber' in (value as object)) {
      return (value as { toNumber(): number }).toNumber()
    }
    return Number(value)
  }

  const holdAmount = summaryRows
    .filter((item) => item.status === 'hold_active')
    .reduce((sum, item) => sum + toNum(item._sum.netAmount), 0)
  const readyAmount = summaryRows
    .filter((item) => item.status === 'payout_ready')
    .reduce((sum, item) => sum + toNum(item._sum.netAmount), 0)
  const paidAmount = summaryRows
    .filter((item) => item.status === 'payout_paid')
    .reduce((sum, item) => sum + toNum(item._sum.netAmount), 0)
  const blockedAmount = summaryRows
    .filter((item) => item.status === 'payout_blocked')
    .reduce((sum, item) => sum + toNum(item._sum.netAmount), 0)
  const penaltyDeducted = toNum(penaltyDeductedDecimal)

  const availableBalance = readyAmount - blockedAmount - penaltyDeducted

  return (
    <div className="space-y-8" data-testid="seller-payouts-page">
      <PageHeader
        title="Ödemeler & Hakediş"
        description="Satış gelirleri, blokeler ve payout durumları"
        actions={
          <Link href="/odemeler/muhasebe-ekstresi">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              Muhasebe Ekstresi
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Bekliyor (30 gün)" value={formatMoney(holdAmount)} icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Ödeme Hazır" value={formatMoney(readyAmount)} icon={<CheckCircle className="h-5 w-5" />} />
        <StatCard title="Toplam Ödendi" value={formatMoney(paidAmount)} icon={<Wallet className="h-5 w-5" />} />
        <StatCard
          title="Kullanılabilir Bakiye"
          value={formatMoney(availableBalance)}
          icon={<Lock className="h-5 w-5" />}
        />
      </div>

      <div
        className="rounded-xl p-4 text-sm"
        style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Ödeme Takvimi:</strong>{' '}
        Teslimat onayından itibaren 30 gün sonra ödeme yapılır. Açık iade veya uyuşmazlık
        durumunda ödeme bloke edilebilir.
      </div>

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Hold bakiyesi</span>
          <span style={{ color: 'var(--color-primary)' }}>{formatMoney(holdAmount)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Ödemeye hazır</span>
          <span style={{ color: 'var(--color-primary)' }}>{formatMoney(readyAmount)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Blokeler</span>
          <span style={{ color: 'var(--color-primary)' }}>-{formatMoney(blockedAmount)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Cezalar</span>
          <span style={{ color: 'var(--color-destructive)' }}>-{formatMoney(penaltyDeducted)}</span>
        </div>
      </div>

      <section>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Payout Listesi
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz payout kaydı yok.
          </p>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <table className="w-full whitespace-nowrap text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Tarih', 'Sipariş No', 'Bloke Süresi (gün)', 'Ödeme Durumu', 'Satıcı Hakediş Tutarı', ''].map(
                    (header) => (
                      <th
                        key={header || 'detay'}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: 'var(--color-muted-fg)' }}
                      >
                        {header}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((payout) => {
                  const net = toNum(payout.netAmount)
                  const statusDisplay = payoutStatusDisplay(payout.status)

                  return (
                    <tr key={payout.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {formatTrDate(payout.holdStartedAt)}
                      </td>
                      <td className="px-4 py-3 font-medium font-mono text-xs" style={{ color: 'var(--color-primary)' }}>
                        {formatOrderDisplayNumber(payout.order?.publicNumber, payout.orderId)}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {holdDaysRemainingLabel(payout.holdUntil)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={statusDisplay.badgeStatus as Parameters<typeof StatusBadge>[0]['status']}
                          label={statusDisplay.label}
                        />
                      </td>
                      <td
                        className="px-4 py-3 font-medium"
                        style={{ color: net < 0 ? 'var(--color-destructive)' : 'var(--color-primary)' }}
                      >
                        {formatMoney(net)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/odemeler/${payout.id}`}>Detay</Link>
                        </Button>
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
