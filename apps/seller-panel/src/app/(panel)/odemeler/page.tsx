import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, PageHeader, StatCard, StatusBadge } from '@hanuja/ui'
import { CheckCircle, Clock, Download, Lock, Wallet } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createSellerLedgerRepository } from '@hanuja/api/repositories/seller-ledger.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ödemeler & Hakediş' }

export default async function PayoutsPage() {
  const { seller } = await getSellerFromSession()
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
    grossAmount: { toNumber(): number } | number
    commissionAmount: { toNumber(): number } | number
    netAmount: { toNumber(): number } | number
    status: string
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

  const balance = holdAmount + readyAmount - blockedAmount - penaltyDeducted

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
        <StatCard title="Bekliyor (30 gün)" value={`₺${holdAmount.toLocaleString('tr-TR')}`} icon={<Clock className="h-5 w-5" />} />
        <StatCard title="Ödeme Hazır" value={`₺${readyAmount.toLocaleString('tr-TR')}`} icon={<CheckCircle className="h-5 w-5" />} />
        <StatCard title="Toplam Ödendi" value={`₺${paidAmount.toLocaleString('tr-TR')}`} icon={<Wallet className="h-5 w-5" />} />
        <StatCard
          title="Güncel Bakiye"
          value={`${balance < 0 ? '-' : ''}₺${Math.abs(balance).toLocaleString('tr-TR')}`}
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
          <span style={{ color: 'var(--color-primary)' }}>₺{holdAmount.toLocaleString('tr-TR')}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Ödemeye hazır</span>
          <span style={{ color: 'var(--color-primary)' }}>₺{readyAmount.toLocaleString('tr-TR')}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Blokeler</span>
          <span style={{ color: 'var(--color-primary)' }}>-₺{blockedAmount.toLocaleString('tr-TR')}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span style={{ color: 'var(--color-muted-fg)' }}>Cezalar</span>
          <span style={{ color: 'var(--color-destructive)' }}>-₺{penaltyDeducted.toLocaleString('tr-TR')}</span>
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
                  {['Sipariş', 'Brüt', 'Komisyon', 'Net', 'Bloke Bitiş', 'Durum'].map((header) => (
                    <th
                      key={header}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((payout) => {
                  const gross = toNum(payout.grossAmount)
                  const commission = toNum(payout.commissionAmount)
                  const net = toNum(payout.netAmount)

                  return (
                    <tr key={payout.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3 font-medium font-mono text-xs" style={{ color: 'var(--color-primary)' }}>
                        #{payout.orderId.slice(-8).toUpperCase()}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {gross > 0 ? `₺${gross.toLocaleString('tr-TR')}` : '-'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {commission > 0 ? `-₺${commission.toLocaleString('tr-TR')}` : '-'}
                      </td>
                      <td
                        className="px-4 py-3 font-medium"
                        style={{ color: net < 0 ? 'var(--color-destructive)' : 'var(--color-primary)' }}
                      >
                        {net >= 0 ? `₺${net.toLocaleString('tr-TR')}` : `-₺${Math.abs(net).toLocaleString('tr-TR')}`}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {payout.holdUntil
                          ? new Date(payout.holdUntil).toLocaleDateString('tr-TR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                          : '-'}
                      </td>
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
