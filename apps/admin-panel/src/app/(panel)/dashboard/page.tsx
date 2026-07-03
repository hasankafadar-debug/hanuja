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
  LifeBuoy,
  BadgeAlert,
  PackageSearch,
  FileWarning,
  RefreshCcw,
} from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createAdminAnalyticsService } from '@hanuja/api/services/admin-analytics.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createFulfillmentRiskService } from '@hanuja/api/services/fulfillment-risk.service'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Kontrol Paneli' }

export default async function AdminDashboardPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const analytics = createAdminAnalyticsService({ prisma })
  const orderSvc = createOrderService({ prisma })
  const fulfillmentRiskSvc = createFulfillmentRiskService({ prisma })

  const [stats, recentOrdersResult, fulfillmentRisks] = await Promise.all([
    analytics.getDashboardStats(),
    orderSvc.listForAdmin({ skip: 0, take: 5 }),
    fulfillmentRiskSvc.listActiveForAdmin({ take: 5 }),
  ])

  type OrderRow = {
    id: string
    publicNumber?: number | null
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{ seller: { profile: { storeName: string } | null } | null }>
  }

  const rows = recentOrdersResult.rows as unknown as OrderRow[]

  const fmt = (n: number) =>
    n >= 1000
      ? `${(n / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })}K TL`
      : `${n.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL`

  const urgentItems: Array<{ type: string; description: string; href: string; urgent: boolean }> = []
  if (stats.payments.pendingEftApprovals > 0) {
    urgentItems.push({
      type: 'EFT Onayi',
      description: `${stats.payments.pendingEftApprovals} havale onay bekliyor`,
      href: '/odemeler?method=eft&status=pending',
      urgent: true,
    })
  }
  if (stats.orders.delayedOrders > 0) {
    urgentItems.push({
      type: 'Gecikme Riski',
      description: `${stats.orders.delayedOrders} siparis sevk riski tasiyor`,
      href: '/siparisler',
      urgent: true,
    })
  }
  for (const risk of fulfillmentRisks) {
    const deadline = new Date(risk.deadlineAt).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
    })
    urgentItems.push({
      type: risk.status === 'breached' ? 'Sevk Suresi Gecti' : 'Sevk Uyarisi',
      description: `${risk.seller.displayName} - ${formatOrderDisplayNumber(risk.order.publicNumber, risk.order.id)} - son tarih ${deadline}`,
      href: `/siparisler/${risk.orderId}`,
      urgent: risk.status === 'breached',
    })
  }
  if (stats.orders.openDisputes > 0) {
    urgentItems.push({
      type: 'Acik Uyusmazlik',
      description: `${stats.orders.openDisputes} uyusmazlik inceleme bekliyor`,
      href: '/uyusmazliklar?status=open',
      urgent: false,
    })
  }
  if (stats.orders.openReturns > 0) {
    urgentItems.push({
      type: 'Acik Iade',
      description: `${stats.orders.openReturns} iade talebi bekliyor`,
      href: '/iadeler',
      urgent: false,
    })
  }
  if (stats.sellers.pendingImportPermissions > 0) {
    urgentItems.push({
      type: 'Hipicon Import Izni',
      description: `${stats.sellers.pendingImportPermissions} satici import izni bekliyor`,
      href: '/saticilar?import=pending',
      urgent: false,
    })
  }

  const statCards = [
    {
      href: null,
      title: 'Bugunku Tahsilat',
      value: fmt(stats.payments.collectedToday),
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      href: '/odemeler?method=eft&status=pending',
      title: 'EFT Onay Bekleyen',
      value: String(stats.payments.pendingEftApprovals),
      icon: <CreditCard className="h-5 w-5" />,
    },
    {
      href: '/hakedisler?status=payout_ready',
      title: 'Hakedis - Vadesi Dolan',
      value: fmt(stats.payouts.payoutReadyTotal),
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      href: '/uyusmazliklar?status=open',
      title: 'Acik Uyusmazlik',
      value: String(stats.orders.openDisputes),
      icon: <AlertOctagon className="h-5 w-5" />,
    },
    {
      href: '/siparisler?status=seller_queue_ready,seller_reviewing',
      title: 'Satici Kuyrugunda',
      value: String(stats.orders.pendingSellerAction),
      icon: <ShoppingBag className="h-5 w-5" />,
    },
    {
      href: '/siparisler',
      title: 'Geciken Siparis',
      value: String(stats.orders.delayedOrders),
      icon: <Clock className="h-5 w-5" />,
    },
    {
      href: null,
      title: 'Bloke Hakedis',
      value: fmt(stats.payouts.blockedPayoutTotal),
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      href: '/saticilar?status=active',
      title: 'Aktif Satici',
      value: String(stats.sellers.totalActive),
      icon: <Store className="h-5 w-5" />,
    },
    {
      href: '/saticilar?import=pending',
      title: 'Hipicon Izin Bekleyen',
      value: String(stats.sellers.pendingImportPermissions),
      icon: <KeyRound className="h-5 w-5" />,
    },
    {
      href: '/musteri-destek?status=waiting_for_admin',
      title: 'Musteri Destek',
      value: `${stats.customerSupport.newTickets} yeni, ${stats.customerSupport.customerReplied} yanit`,
      icon: <LifeBuoy className="h-5 w-5" />,
    },
    {
      href: '/teslim-onayi',
      title: 'Teslim Onayi',
      value: String(stats.orders.pendingDeliveryConfirmation),
      icon: <BadgeAlert className="h-5 w-5" />,
    },
    {
      href: '/urunler',
      title: 'Urun Moderasyon',
      value: String(stats.moderation.pendingProducts),
      icon: <PackageSearch className="h-5 w-5" />,
    },
    {
      href: '/cezalar?tab=unbilled',
      title: 'Yeni Cezalar',
      value: String(stats.penalties.newCount),
      icon: <AlertTriangle className="h-5 w-5" />,
    },
    {
      href: '/komisyonlar',
      title: 'Komisyon Faturasi',
      value: String(stats.invoices.pendingCommission),
      icon: <FileWarning className="h-5 w-5" />,
    },
    {
      href: '/ek-sure-talepleri',
      title: 'Ek Sure Talebi',
      value: String(stats.extensions.pending),
      icon: <RefreshCcw className="h-5 w-5" />,
    },
    {
      href: '/iadeler',
      title: 'Iade Talepleri',
      value: String(stats.orders.openReturns),
      icon: <RefreshCcw className="h-5 w-5" />,
    },
    {
      href: '/destek',
      title: 'Satici Destek',
      value: String(stats.customerSupport.sellerPending),
      icon: <LifeBuoy className="h-5 w-5" />,
    },
  ] as const

  return (
    <div className="space-y-8" data-testid="admin-dashboard-page">
      <PageHeader
        title="Kontrol Paneli"
        description={`Pazar yeri genel gorunumu - ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => {
          const content = (
            <StatCard
              title={card.title}
              value={card.value}
              icon={card.icon}
              {...(card.href ? { className: 'transition-shadow hover:shadow-sm' } : {})}
            />
          )
          return card.href ? (
            <Link key={card.title} href={card.href} className="block">
              {content}
            </Link>
          ) : (
            <div key={card.title}>{content}</div>
          )
        })}
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
                <Link key={`${item.href}-${i}`} href={item.href}>
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
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>Son Siparisler</h2>
            <Link href="/siparisler" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>
              Tumu →
            </Link>
          </div>
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            {rows.length === 0 ? (
              <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Henuz siparis yok.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                  <tr>
                    {['Siparis', 'Satici', 'Tutar', 'Durum', 'Tarih'].map((h) => (
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
                  {rows.map((order) => {
                    const amount =
                      typeof order.totalAmount === 'number'
                        ? order.totalAmount
                        : order.totalAmount.toNumber()
                    const sellerName = order.lines[0]?.seller?.profile?.storeName ?? '-'

                    return (
                      <tr
                        key={order.id}
                        className="border-t hover:bg-[var(--color-muted)]"
                        style={{ borderColor: 'var(--color-border)' }}
                      >
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/siparisler/${order.id}`}
                            className="font-medium hover:underline"
                            style={{ color: 'var(--color-primary)' }}
                          >
                            {formatOrderDisplayNumber(order.publicNumber, order.id)}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--color-muted-fg)' }}>
                          {sellerName}
                        </td>
                        <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--color-primary)' }}>
                          {amount.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={order.status as never} />
                        </td>
                        <td className="px-3 py-2.5" style={{ color: 'var(--color-muted-fg)' }}>
                          {new Date(order.createdAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
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
