import type { Metadata } from 'next'
import { StatCard, StatusBadge, EmptyState, PageHeader } from '@hanuja/ui'
import { ShoppingBag, Wallet, AlertTriangle, RotateCcw, Clock, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Kontrol Paneli' }

export default async function SellerDashboardPage() {
  const { seller } = await getSellerFromSession()

  const prisma = createPrismaForRoute()
  const orderSvc = createOrderService({ prisma })
  const payoutRepo = createPayoutRepository(prisma)

  const [recentOrders, payoutSummary, openReturns] = await Promise.all([
    orderSvc.listForSellerQueue(seller.id, 0, 5),
    payoutRepo.getSummaryBySeller(seller.id),
    prisma.returnRequest.count({
      where: {
        order: { lines: { some: { sellerId: seller.id } } },
        status: { notIn: ['refund_completed', 'rejected'] },
      },
    }),
  ])

  type OrderRow = {
    id: string
    createdAt: Date
    status: string
    paymentConfirmedAt?: Date | null
    lines: Array<{
      unitPrice: { toNumber(): number } | number
      quantity: number
      product: { name: string } | null
    }>
  }

  type SummaryRow = { status: string; _sum: { netAmount: unknown } }

  const toNum = (v: unknown) => {
    if (v === null || v === undefined) return 0
    if (typeof v === 'object' && 'toNumber' in (v as object)) return (v as { toNumber(): number }).toNumber()
    return Number(v)
  }

  const rows = recentOrders as unknown as OrderRow[]
  const summaryTyped = payoutSummary as unknown as SummaryRow[]

  const pendingOrders = rows.filter((o) =>
    ['seller_queue_ready', 'seller_reviewing', 'seller_accepted', 'preparing', 'awaiting_shipment'].includes(o.status)
  ).length

  const holdAmount = summaryTyped.filter((s) => s.status === 'hold_active').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)
  const readyAmount = summaryTyped.filter((s) => s.status === 'payout_ready').reduce((acc, s) => acc + toNum(s._sum.netAmount), 0)

  // Find orders approaching 20-day deadline
  const now = Date.now()
  const delayedOrders = rows.filter((o) => {
    if (!o.paymentConfirmedAt) return false
    const deadline = new Date(o.paymentConfirmedAt).getTime() + 20 * 24 * 60 * 60 * 1000
    const daysLeft = (deadline - now) / (1000 * 60 * 60 * 24)
    return daysLeft <= 5 && daysLeft > 0 &&
      ['seller_queue_ready', 'seller_accepted', 'preparing', 'awaiting_shipment'].includes(o.status)
  })

  return (
    <div className="space-y-8">
      <PageHeader title="Kontrol Paneli" description="Mağaza performansınıza genel bakış" />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Bekleyen Sipariş"
          value={String(pendingOrders)}
          icon={<ShoppingBag className="h-5 w-5" />}
        />
        <StatCard
          title="Bekleyen Hakediş"
          value={`₺${holdAmount.toLocaleString('tr-TR')}`}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Ödeme Hazır"
          value={`₺${readyAmount.toLocaleString('tr-TR')}`}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <StatCard
          title="Açık İade"
          value={String(openReturns)}
          icon={<RotateCcw className="h-5 w-5" />}
        />
      </div>

      {/* Delay warning */}
      {delayedOrders.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb' }}
        >
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              {delayedOrders.length} siparişin kargo süresi yaklaşıyor
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e' }}>
              Kargo taahhüdünüzü yerine getirmeyi unutmayın. Süre aşılması %20 cezaya yol açabilir.
            </p>
          </div>
        </div>
      )}

      {/* Recent orders */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Son Siparişler</h2>
          <Link href="/siparisler" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>
            Tümünü Gör →
          </Link>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" />}
            title="Henüz sipariş yok"
            description="Ürünlerinize gelen siparişler burada görünecek."
          />
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Sipariş No', 'Ürün', 'Tarih', 'Durum', 'Tutar'].map((h) => (
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
                {rows.map((order) => {
                  const firstProductName = order.lines[0]?.product?.name ?? 'Ürün'
                  const total = order.lines.reduce((sum, l) => {
                    const price = typeof l.unitPrice === 'object' ? l.unitPrice.toNumber() : Number(l.unitPrice)
                    return sum + price * l.quantity
                  }, 0)
                  const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
                    day: 'numeric', month: 'short', year: 'numeric',
                  })
                  return (
                    <tr
                      key={order.id}
                      className="border-t transition-colors hover:bg-[var(--color-muted)]"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/siparisler/${order.id}`}
                          className="font-medium hover:underline font-mono text-xs"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          #{order.id.slice(-8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {firstProductName}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{date}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                        ₺{total.toLocaleString('tr-TR')}
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
