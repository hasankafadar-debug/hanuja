import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState, PageHeader, StatCard, StatusBadge } from '@hanuja/ui'
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  Clock,
  Package,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPayoutRepository } from '@hanuja/api/repositories/payout.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { formatMoney } from '@hanuja/security'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Kontrol Paneli' }

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

function formatDateInput(date: Date) {
  const year = date.getUTCFullYear()
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${date.getUTCDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export default async function SellerDashboardPage({ searchParams }: Props) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const orderService = createOrderService({ prisma })
  const payoutRepo = createPayoutRepository(prisma)
  const platformSettings = await createPlatformSettingsService({ prisma }).get()
  const effectiveCommissionRate =
    seller.commissionRateOverride ?? platformSettings.defaultSellerCommissionRate

  const now = new Date()
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  const defaultFrom = new Date(defaultTo)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29)
  defaultFrom.setUTCHours(0, 0, 0, 0)

  const chartFromInput = getSingleValue(resolvedSearchParams.from) ?? formatDateInput(defaultFrom)
  const chartToInput = getSingleValue(resolvedSearchParams.to) ?? formatDateInput(defaultTo)
  const chartFrom = new Date(`${chartFromInput}T00:00:00.000Z`)
  const chartTo = new Date(`${chartToInput}T23:59:59.999Z`)

  const last30Days = new Date(defaultTo)
  last30Days.setUTCDate(last30Days.getUTCDate() - 29)
  last30Days.setUTCHours(0, 0, 0, 0)

  const todayStart = new Date(defaultTo)
  todayStart.setUTCHours(0, 0, 0, 0)

  const last7Days = new Date(defaultTo)
  last7Days.setUTCDate(last7Days.getUTCDate() - 6)
  last7Days.setUTCHours(0, 0, 0, 0)

  const [recentOrders, payoutSummary, openReturns, sellerOrders, chartOrders, productCounts, topOrderLines] = await Promise.all([
    orderService.listForSellerQueue({ sellerId: seller.id, skip: 0, take: 5 }),
    payoutRepo.getSummaryBySeller(seller.id),
    prisma.returnRequest.count({
      where: {
        order: { lines: { some: { sellerId: seller.id } } },
        status: { notIn: ['refund_completed', 'rejected'] },
      },
    }),
    prisma.order.findMany({
      where: {
        lines: { some: { sellerId: seller.id } },
        createdAt: { gte: last30Days },
        status: {
          in: [
            'seller_queue_ready',
            'seller_reviewing',
            'seller_accepted',
            'preparing',
            'awaiting_shipment',
            'shipped',
            'delivered',
            'delivery_confirmation_pending',
            'delivery_confirmed',
            'seller_rejected',
            'cancelled_by_customer',
            'cancelled_by_admin',
            'cancelled_due_to_seller_rejection',
            'cancelled_due_to_20day_breach',
            'return_requested',
            'return_under_review',
            'return_approved',
            'return_received',
            'refund_completed',
          ],
        },
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        paymentConfirmedAt: true,
        shippedAt: true,
        lines: {
          where: { sellerId: seller.id },
          select: {
            quantity: true,
            totalPrice: true,
            productName: true,
          },
        },
      },
    }),
    prisma.order.findMany({
      where: {
        lines: { some: { sellerId: seller.id } },
        createdAt: { gte: chartFrom, lte: chartTo },
        status: {
          in: [
            'seller_queue_ready',
            'seller_reviewing',
            'seller_accepted',
            'preparing',
            'awaiting_shipment',
            'shipped',
            'delivered',
            'delivery_confirmation_pending',
            'delivery_confirmed',
          ],
        },
      },
      select: {
        createdAt: true,
        lines: {
          where: { sellerId: seller.id },
          select: {
            quantity: true,
            totalPrice: true,
          },
        },
      },
    }),
    Promise.all([
      prisma.product.count({ where: { sellerId: seller.id, status: 'published', stockQuantity: { gt: 0 } } }),
      prisma.product.count({ where: { sellerId: seller.id, status: 'published', stockQuantity: 0 } }),
      prisma.product.count({ where: { sellerId: seller.id, status: 'published', orderLines: { none: {} } } }),
    ]),
    prisma.orderLine.groupBy({
      by: ['productId'],
      where: {
        sellerId: seller.id,
        order: {
          status: {
            in: [
              'seller_queue_ready',
              'seller_reviewing',
              'seller_accepted',
              'preparing',
              'awaiting_shipment',
              'shipped',
              'delivered',
              'delivery_confirmation_pending',
              'delivery_confirmed',
              'return_requested',
              'return_under_review',
              'return_approved',
              'refund_completed',
            ],
          },
        },
      },
      _sum: { quantity: true },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: 5,
    }),
  ])

  type RecentOrder = {
    id: string
    publicNumber?: number | null
    createdAt: Date
    status: string
    lines: Array<{
      unitPrice: { toNumber(): number } | number
      quantity: number
      product: { name: string } | null
    }>
  }

  const toNumber = (value: unknown) => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'object' && 'toNumber' in (value as object)) {
      return (value as { toNumber(): number }).toNumber()
    }
    return Number(value)
  }

  const recentRows = recentOrders as unknown as RecentOrder[]
  const summaryRows = payoutSummary as Array<{ status: string; _sum: { netAmount: unknown } }>
  const readyAmount = summaryRows
    .filter((item) => item.status === 'payout_ready')
    .reduce((sum, item) => sum + toNumber(item._sum.netAmount), 0)
  const holdAmount = summaryRows
    .filter((item) => item.status === 'hold_active')
    .reduce((sum, item) => sum + toNumber(item._sum.netAmount), 0)

  const pendingOrders = sellerOrders.filter((order) => ['seller_queue_ready', 'seller_reviewing'].includes(order.status)).length
  const shippedDurations = sellerOrders
    .filter((order) => order.paymentConfirmedAt && order.shippedAt)
    .map((order) => {
      const diffMs = new Date(order.shippedAt!).getTime() - new Date(order.paymentConfirmedAt!).getTime()
      return diffMs / (1000 * 60 * 60 * 24)
    })
  const averagePreparationDays = shippedDurations.length
    ? shippedDurations.reduce((sum, days) => sum + days, 0) / shippedDurations.length
    : 0
  const cancellationCount = sellerOrders.filter((order) => order.status.startsWith('cancelled_')).length
  const supplierFailureCount = sellerOrders.filter((order) => order.status === 'cancelled_due_to_seller_rejection').length
  const cancellationRate = sellerOrders.length ? (cancellationCount / sellerOrders.length) * 100 : 0
  const supplierFailureRate = sellerOrders.length ? (supplierFailureCount / sellerOrders.length) * 100 : 0

  const calculateSalesSummary = (start: Date) => {
    const rows = sellerOrders.filter(
      (order) =>
        order.createdAt >= start &&
        !order.status.startsWith('cancelled_') &&
        order.status !== 'seller_rejected',
    )

    return {
      count: rows.length,
      amount: rows.reduce(
        (sum, order) =>
          sum +
          order.lines.reduce((lineSum, line) => lineSum + toNumber(line.totalPrice), 0),
        0,
      ),
    }
  }

  const todaySales = calculateSalesSummary(todayStart)
  const last7Sales = calculateSalesSummary(last7Days)
  const last30SalesSummary = calculateSalesSummary(last30Days)

  const chartBucketCount = Math.max(
    1,
    Math.round((chartTo.getTime() - chartFrom.getTime()) / (1000 * 60 * 60 * 24)) + 1,
  )
  const chartBuckets = Array.from({ length: chartBucketCount }, (_, index) => {
    const bucketDate = new Date(chartFrom)
    bucketDate.setUTCDate(bucketDate.getUTCDate() + index)
    const key = bucketDate.toISOString().slice(0, 10)
    const dayOrders = chartOrders.filter((order) => order.createdAt.toISOString().slice(0, 10) === key)
    return {
      key,
      label: bucketDate.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' }),
      count: dayOrders.length,
      amount: dayOrders.reduce(
        (sum, order) =>
          sum +
          order.lines.reduce((lineSum, line) => lineSum + toNumber(line.totalPrice), 0),
        0,
      ),
    }
  })
  const maxChartAmount = Math.max(1, ...chartBuckets.map((bucket) => bucket.amount))

  const topProductIds = topOrderLines.map((item) => item.productId)
  const topProducts = topProductIds.length
    ? await prisma.product.findMany({
        where: {
          id: { in: topProductIds },
        },
        select: {
          id: true,
          name: true,
          images: {
            select: { url: true },
            take: 1,
          },
        },
      })
    : []
  const topProductMap = new Map(topProducts.map((product) => [product.id, product]))

  // refreshActiveRisks is handled by the BullMQ fulfillment-risk job — not on every page load
  const sellerFulfillmentRisks = await prisma.fulfillmentRisk.findMany({
    where: {
      sellerId: seller.id,
      status: { in: ['warning', 'breached'] },
    },
    select: {
      orderId: true,
      status: true,
      deadlineAt: true,
    },
  })
  const criticalLateOrders = sellerFulfillmentRisks.filter((risk) => risk.status === 'breached')
  const warningSoonOrders = sellerFulfillmentRisks.filter((risk) => risk.status === 'warning')
  const delayedOrders = sellerFulfillmentRisks.length

  return (
    <div className="space-y-8" data-testid="seller-dashboard-page">
      <PageHeader title="Kontrol Paneli" description="Mağaza performansına genel bakış" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Link href="/siparisler?status=seller_queue_ready,seller_reviewing" className="block">
          <StatCard title="Bekleyen Sipariş" value={pendingOrders} icon={<ShoppingBag className="h-5 w-5" />} className="transition-shadow hover:shadow-sm" />
        </Link>
        <Link href="/odemeler?status=hold_active" className="block">
          <StatCard title="Bekleyen Hakediş" value={formatMoney(holdAmount)} icon={<Clock className="h-5 w-5" />} className="transition-shadow hover:shadow-sm" />
        </Link>
        <Link href="/odemeler?status=payout_ready" className="block">
          <StatCard title="Ödeme Hazır" value={formatMoney(readyAmount)} icon={<CheckCircle className="h-5 w-5" />} className="transition-shadow hover:shadow-sm" />
        </Link>
        <Link href="/iadeler" className="block">
          <StatCard title="Açık İade" value={openReturns} icon={<AlertTriangle className="h-5 w-5" />} className="transition-shadow hover:shadow-sm" />
        </Link>
        <Link href="/siparisler?tab=tum&filter=late" className="block">
          <StatCard
            title="Gecikenler"
            value={delayedOrders}
            icon={<AlertTriangle className="h-5 w-5" />}
            className="transition-shadow hover:shadow-sm"
          />
        </Link>
      </div>

      {criticalLateOrders.length > 0 ? (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#dc2626', backgroundColor: '#fef2f2' }}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#dc2626' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#991b1b' }}>
              {criticalLateOrders.length} sipariş sevk taahhüdünü aştı
            </p>
            <p className="text-xs" style={{ color: '#991b1b' }}>
              Sistem bu gecikmeleri admine bildirir. Sevki hızlandırıp gerekiyorsa adminle koordine olun.
            </p>
          </div>
        </div>
      ) : null}

      {warningSoonOrders.length > 0 ? (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb' }}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: '#f59e0b' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              {warningSoonOrders.length} sipariş sevk uyarı penceresinde
            </p>
            <p className="text-xs" style={{ color: '#92400e' }}>
              Sevk süresi yaklaştı. Bu siparişleri gecikmeye düşmeden kargoya verin.
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Kalite Metrikleri
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Son 30 gün operasyon görünümü
              </p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-4">
            <StatCard title="İşlem Bekleyen" value={pendingOrders} icon={<ShoppingBag className="h-4 w-4" />} />
            <StatCard title="Ort. Hazırlama" value={`${averagePreparationDays.toFixed(1)} gün`} icon={<Clock className="h-4 w-4" />} />
            <StatCard title="İptal Oranı" value={`%${cancellationRate.toFixed(1)}`} icon={<AlertTriangle className="h-4 w-4" />} />
            <StatCard title="Tedarik Edememe" value={`%${supplierFailureRate.toFixed(1)}`} icon={<Package className="h-4 w-4" />} />
          </div>
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Satış Performansı
          </h2>
          <div className="space-y-4">
            {[
              { label: 'Bugün Yapılan Satış', value: todaySales },
              { label: 'Son 7 Günlük Satış', value: last7Sales },
              { label: 'Son 30 Günlük Satış', value: last30SalesSummary },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {item.label}
                </p>
                <p className="mt-1 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  {item.value.count} sipariş / {formatMoney(item.value.amount)}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr,1fr]">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Satış Özeti
              </h2>
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Tarih aralığına göre günlük satış dağılımı
              </p>
            </div>
            <form className="flex flex-wrap items-center gap-2">
              <input
                id="dashboard-from"
                type="date"
                name="from"
                aria-label="Başlangıç tarihi"
                defaultValue={chartFromInput}
                className="h-9 rounded-lg border px-3 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
              />
              <input
                id="dashboard-to"
                type="date"
                name="to"
                aria-label="Bitiş tarihi"
                defaultValue={chartToInput}
                className="h-9 rounded-lg border px-3 text-sm"
                style={{
                  borderColor: 'var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-primary)',
                }}
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg border px-3 text-sm"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
              >
                Uygula
              </button>
            </form>
          </div>
          <div className="overflow-x-auto pb-2">
            <div
              className="grid h-72 min-w-[46rem] gap-3 sm:min-w-0"
              style={{ gridTemplateColumns: `repeat(${chartBuckets.length}, minmax(0, 1fr))` }}
            >
              {chartBuckets.map((bucket, index) => (
              <div key={bucket.key} className="flex flex-col justify-end gap-2">
                <div
                  className="rounded-t-md"
                  style={{
                    height: `${Math.max(8, (bucket.amount / maxChartAmount) * 180)}px`,
                    background: 'linear-gradient(180deg, rgba(19,88,84,0.9) 0%, rgba(19,88,84,0.45) 100%)',
                  }}
                  title={`${bucket.label}: ${formatMoney(bucket.amount)}`}
                />
                <div
                  className="flex h-16 items-start justify-center text-xs tabular-nums"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  <span
                    className="origin-top whitespace-nowrap"
                    style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
                  >
                    <span className="sm:hidden">{index % 2 === 0 || index === chartBuckets.length - 1 ? bucket.label : ''}</span>
                    <span className="hidden sm:inline">{bucket.label}</span>
                  </span>
                </div>
              </div>
              ))}
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
              Ürünler
            </h2>
            <div className="space-y-3">
              {[
                { label: 'Satışta', value: productCounts[0] },
                { label: 'Tükenen', value: productCounts[1] },
                { label: 'Satışa Dönüşmeyen', value: productCounts[2] },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--color-muted-fg)' }}>{item.label}</span>
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    {item.value} ürün
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                En Çok Satan 5 Ürün
              </h2>
            </div>
            <div className="space-y-3">
              {topOrderLines.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Henüz satış verisi yok.
                </p>
              ) : (
                topOrderLines.map((item) => {
                  const product = topProductMap.get(item.productId)
                  return (
                    <div key={item.productId} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-lg"
                          style={{ backgroundColor: 'var(--color-muted)' }}
                        >
                          <BarChart3 className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
                        </div>
                        <div>
                          <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                            {product?.name ?? 'Ürün'}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                        {item._sum.quantity ?? 0} adet
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </div>

      <div className="w-full xl:max-w-sm">
        <div
          className="rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Komisyon Oranı
          </p>
          <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
            %{(effectiveCommissionRate.toNumber() * 100).toFixed(2)}
          </p>
        </div>
      </div>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            Son Siparişler
          </h2>
          <Link href="/siparisler" className="text-sm hover:underline" style={{ color: 'var(--color-accent)' }}>
            Tümünü Gör →
          </Link>
        </div>
        {recentRows.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-8 w-8" />}
            title="Henüz sipariş yok"
            description="Ürünlerinize gelen siparişler burada görünecek."
          />
        ) : (
          <div
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <table className="w-full text-sm">
              <thead style={{ backgroundColor: 'var(--color-muted)' }}>
                <tr>
                  {['Sipariş No', 'Ürün', 'Tarih', 'Durum', 'Tutar'].map((header) => (
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
                {recentRows.map((order) => {
                  const total = order.lines.reduce((sum, line) => {
                    const unitPrice =
                      typeof line.unitPrice === 'object' && 'toNumber' in line.unitPrice
                        ? line.unitPrice.toNumber()
                        : Number(line.unitPrice)
                    return sum + unitPrice * line.quantity
                  }, 0)
                  const firstProduct = order.lines[0]?.product?.name ?? 'Ürün'

                  return (
                    <tr key={order.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-4 py-3">
                        <Link
                          href={`/siparisler/${order.id}`}
                          className="font-medium hover:underline"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {formatOrderDisplayNumber(order.publicNumber, order.id)}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {firstProduct}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                        {new Date(order.createdAt).toLocaleDateString('tr-TR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
                      </td>
                      <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                        {formatMoney(total)}
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
