import type { Metadata } from 'next'
import Link from 'next/link'
import { StatCard, StatusBadge, PageHeader } from '@hanuja/ui'
import {
  ShoppingBag,
  CreditCard,
  Wallet,
  AlertOctagon,
  TrendingUp,
  Clock,
  AlertTriangle,
  Store,
  KeyRound,
} from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAnalyticsService } from '@hanuja/api/services/admin-analytics.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createOrderService } from '@hanuja/api/services/order.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Kontrol Paneli' }

export default async function AdminDashboardPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const analytics = createAdminAnalyticsService({ prisma })
  const orderSvc = createOrderService({ prisma })

  const [stats, recentOrdersResult] = await Promise.all([
    analytics.getDashboardStats(),
    orderSvc.listForAdmin({ skip: 0, take: 5 }),
  ])

  type OrderRow = {
    id: string
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{ seller: { profile: { storeName: string } | null } | null }>
  }

  const rows = recentOrdersResult.rows as unknown as OrderRow[]

  const fmt = (n: number) =>
    n >= 1000 ? `₺${(n / 1000).toFixed(1)}K` : `₺${n.toLocaleString('tr-TR')}`

  const urgentItems: Array<{ type: string; description: string; href: string; urgent: boolean }> = []
  if (stats.payments.pendingEftApprovals > 0) {
    urgentItems.push({
      type: 'EFT Onayı',
      description: `${stats.payments.pendingEftApprovals} havale onay bekliyor`,
      href: '/odemeler?method=eft&status=pending',
      urgent: true,
    })
  }
  if (stats.orders.delayedOrders > 0) {
    urgentItems.push({
      type: 'Gecikme Riski',
      description: `${stats.orders.delayedOrders} sipariş 20 gün sınırında`,
      href: '/siparisler',
      urgent: true,
    })
  }
  if (stats.orders.openDisputes > 0) {
    urgentItems.push({
      type: 'Açık Uyuşmazlık',
      description: `${stats.orders.openDisputes} uyuşmazlık inceleme bekliyor`,
      href: '/uyusmazliklar?status=open',
      urgent: false,
    })
  }
  if (stats.orders.openReturns > 0) {
    urgentItems.push({
      type: 'Açık İade',
      description: `${stats.orders.openReturns} iade talebi bekliyor`,
      href: '/iadeler',
      urgent: false,
    })
  }
  if (stats.sellers.pendingImportPermissions > 0) {
    urgentItems.push({
      type: 'Hipicon Import İzni',
      description: `${stats.sellers.pendingImportPermissions} satıcı import izni bekliyor`,
      href: '/saticilar?import=pending',
      urgent: false,
    })
  }

  return (
    <div className="space-y-8" data-testid="admin-dashboard-page">
      <PageHeader
        title="Kontrol Paneli"
        description={`Pazar yeri genel görünümü — ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Bugünkü Tahsilat"
          value={fmt(stats.payments.collectedToday)}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <Link href="/odemeler?method=eft&status=pending" className="block">
          <StatCard
            title="EFT Onay Bekleyen"
            value={String(stats.payments.pendingEftApprovals)}
            icon={<CreditCard className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
        <StatCard
          title="Ödeme Hazır"
          value={fmt(stats.payouts.payoutReadyTotal)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <Link href="/uyusmazliklar?status=open" className="block">
          <StatCard
            title="Açık Uyuşmazlık"
            value={String(stats.orders.openDisputes)}
            icon={<AlertOctagon className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href="/siparisler?status=seller_queue_ready,seller_reviewing" className="block">
          <StatCard
            title="Satıcı Kuyruğunda"
            value={String(stats.orders.pendingSellerAction)}
            icon={<ShoppingBag className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
        <StatCard
          title="Geciken Sipariş"
          value={String(stats.orders.delayedOrders)}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Bloke Hakediş"
          value={fmt(stats.payouts.blockedPayoutTotal)}
          icon={<Wallet className="h-5 w-5" />}
        />
        <Link href="/saticilar?status=active" className="block">
          <StatCard
            title="Aktif Satıcı"
            value={String(stats.sellers.totalActive)}
            icon={<Store className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
        <Link href="/saticilar?import=pending" className="block">
          <StatCard
            title="Hipicon İzin Bekleyen"
            value={String(stats.sellers.pendingImportPermissions)}
            icon={<KeyRound className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>Acil Kuyruk</h2>
          {urgentItems.length === 0 ? (
            <div
              className="rounded-xl border p-6 text-center text-sm"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
            >
              Acil bekleyen madde yok.
            </div>
          ) : (
            <div className="space-y-2">
              {urgentItems.map((item, i) => (
                <Link key={i} href={item.href}>
                  <div
                    className="flex items-start gap-3 rounded-xl border p-4 transition-shadow hover:shadow-sm"
                    style={{
                      borderColor: item.urgent ? '#fca5a5' : 'var(--color-border)',
                      backgroundColor: item.urgent ? '#fff5f5' : 'var(--color-surface)',
                    }}
                  >
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      style={{ color: item.urgent ? 'var(--color-destructive)' : 'var(--color-warning)' }}
                    />
                    <div>
                      <p
                        className="text-xs font-semibold uppercase tracking-wide"
                        style={{ color: item.urgent ? 'var(--color-destructive)' : 'var(--color-warning)' }}
                      >
                        {item.type}
                      </p>
                      <p className="mt-0.5 text-sm" style={{ color: 'var(--color-primary)' }}>
                        {item.description}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Son Siparişler</h2>
            <Link href="/siparisler" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>
              Tümü →
            </Link>
          </div>
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Henüz sipariş yok.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                  <tr>
                    {['Sipariş', 'Satıcı', 'Tutar', 'Durum', 'Tarih'].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold"
                        style={{ color: 'var(--color-muted-fg)' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => {
                    const amount = typeof o.totalAmount === 'number'
                      ? o.totalAmount
                      : o.totalAmount.toNumber()
                    const sellerName = o.lines[0]?.seller?.profile?.storeName ?? '—'
                    return (
                      <tr
                        key={o.id}
                        className="border-t hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/siparisler/${o.id}`}
                            className="font-medium hover:underline"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {o.id.slice(-8).toUpperCase()}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--color-muted-fg)' }}>
                          {sellerName}
                        </td>
                        <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--color-primary)' }}>
                          ₺{amount.toLocaleString('tr-TR')}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={o.status as never} />
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--color-muted-fg)' }}>
                          {new Date(o.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
