import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, EmptyState, PageHeader, StatusBadge } from '@hanuja/ui'
import { Download, ShoppingBag } from 'lucide-react'
import { maskCustomerName, formatMoney } from '@hanuja/security'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import {
  SELLER_ORDER_TABS,
  getSellerOrderStatusesForTab,
  getSellerOrderTabLabel,
  isSellerOrderTab,
  type SellerOrderTab,
} from '@hanuja/api/domain/seller-order-tabs'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Siparişler' }

interface Props {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function getSingleValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

function toDateStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`)
}

function toDateEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`)
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value))
    }
  })
  const result = search.toString()
  return result ? `?${result}` : ''
}

export default async function SellerOrdersPage({ searchParams }: Props) {
  const resolvedSearchParams = (await searchParams) ?? {}
  const { seller } = await getSellerFromSession()
  const prisma = createPrismaForRoute()
  const service = createOrderService({ prisma })

  const tabParam = getSingleValue(resolvedSearchParams.tab)
  const currentTab: SellerOrderTab = tabParam && isSellerOrderTab(tabParam) ? tabParam : 'tum'
  const filter = getSingleValue(resolvedSearchParams.filter)
  const lateOnly = filter === 'late'
  const missingInvoice = currentTab === 'faturasi-olmayanlar'
  const q = getSingleValue(resolvedSearchParams.q)?.trim() ?? ''
  const from = getSingleValue(resolvedSearchParams.from) ?? ''
  const to = getSingleValue(resolvedSearchParams.to) ?? ''
  const page = Math.max(1, Number(getSingleValue(resolvedSearchParams.page) ?? '1') || 1)
  const pageSize = 20
  const skip = (page - 1) * pageSize

  const baseFilters = {
    sellerId: seller.id,
    ...(q ? { query: q } : {}),
    ...(from ? { from: toDateStart(from) } : {}),
    ...(to ? { to: toDateEnd(to) } : {}),
  }
  const lateOrderIds = lateOnly
    ? (await prisma.fulfillmentRisk.findMany({
        where: { sellerId: seller.id, status: { in: ['warning', 'breached'] } },
        select: { orderId: true },
      })).map((risk) => risk.orderId)
    : undefined

  const [orders, total, counts] = await Promise.all([
    service.listForSellerQueue({
      ...baseFilters,
      ...(lateOrderIds ? { orderIds: lateOrderIds } : {}),
      status: getSellerOrderStatusesForTab(currentTab),
      ...(missingInvoice ? { missingInvoice: true } : {}),
      skip,
      take: pageSize,
    }),
    service.countForSellerQueue({
      ...baseFilters,
      ...(lateOrderIds ? { orderIds: lateOrderIds } : {}),
      status: getSellerOrderStatusesForTab(currentTab),
      ...(missingInvoice ? { missingInvoice: true } : {}),
    }),
    Promise.all(
      SELLER_ORDER_TABS.map(async (tab) => ({
        tab,
        count: await service.countForSellerQueue({
          ...baseFilters,
          ...(tab === 'tum' ? {} : { status: getSellerOrderStatusesForTab(tab) }),
          ...(tab === 'faturasi-olmayanlar' ? { missingInvoice: true } : {}),
        }),
      })),
    ),
  ])

  type OrderRow = {
    id: string
    publicNumber?: number | null
    createdAt: Date
    status: string
    totalAmount?: { toNumber(): number } | number | null
    customer?: { name?: string | null } | null
    address?: { fullName?: string | null } | null
    lines: Array<{
      quantity: number
      unitPrice: { toNumber(): number } | number
      product: { name: string } | null
    }>
  }

  const rows = orders as unknown as OrderRow[]
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const exportHref = `/api/seller/orders${buildQueryString({
    tab: currentTab,
    q: q || undefined,
    from: from || undefined,
    to: to || undefined,
    format: 'csv',
  })}`

  return (
    <div className="space-y-6">
      <PageHeader
        title="Siparişler"
        description={`${total} sipariş`}
        actions={
          <Link href={exportHref}>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              CSV dışa aktar
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        {counts.map(({ tab, count }) => {
          const href = buildQueryString({
            tab,
            q: q || undefined,
            from: from || undefined,
            to: to || undefined,
            filter: lateOnly ? 'late' : undefined,
          })
          const isActive = tab === currentTab

          return (
            <Link
              key={tab}
              href={`/siparisler${href}`}
              className="rounded-full border px-3 py-2 text-sm transition-colors"
              style={{
                borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: isActive ? 'var(--color-muted)' : 'var(--color-surface)',
                color: 'var(--color-primary)',
              }}
            >
              {getSellerOrderTabLabel(tab)} ({count})
            </Link>
          )
        })}
      </div>

      <form
        className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1.3fr,1fr,1fr,auto]"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <input type="hidden" name="tab" value={currentTab} />
        {lateOnly ? <input type="hidden" name="filter" value="late" /> : null}
        <input
          type="text"
          name="q"
          defaultValue={q}
          aria-label="Sipariş no veya müşteri ara"
          placeholder="Sipariş no veya müşteri ara"
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <input
          id="orders-from"
          type="date"
          name="from"
          aria-label="Başlangıç tarihi"
          defaultValue={from}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <input
          id="orders-to"
          type="date"
          name="to"
          aria-label="Bitiş tarihi"
          defaultValue={to}
          className="h-10 rounded-lg border px-3 text-sm"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-primary)',
          }}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Filtreyi uygula
          </Button>
          <Link href={`/siparisler?tab=${currentTab}`}>
            <Button type="button" variant="ghost" size="sm">
              Temizle
            </Button>
          </Link>
        </div>
      </form>

      <div
        className="overflow-hidden rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <div className="p-12">
            <EmptyState
              icon={<ShoppingBag className="h-10 w-10" />}
              title="Filtreye uygun sipariş yok"
              description="Seçili sekmede veya filtrelerde eşleşen sipariş bulunamadı."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş No', 'Tarih', 'Müşteri', 'Durum', 'Toplam Tutar', 'Aksiyon'].map((header) => (
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
              {rows.map((order) => {
                const displayTotal =
                  order.totalAmount !== null && order.totalAmount !== undefined
                    ? typeof order.totalAmount === 'object' && 'toNumber' in order.totalAmount
                      ? order.totalAmount.toNumber()
                      : Number(order.totalAmount)
                    : order.lines.reduce((sum, line) => {
                        const unitPrice =
                          typeof line.unitPrice === 'object' && 'toNumber' in line.unitPrice
                            ? line.unitPrice.toNumber()
                            : Number(line.unitPrice)
                        return sum + unitPrice * line.quantity
                      }, 0)

                return (
                  <tr
                    key={order.id}
                    data-testid="order-row"
                    className="border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
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
                      {new Date(order.createdAt).toLocaleDateString('tr-TR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {order.address?.fullName ?? maskCustomerName(order.customer?.name)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={order.status as Parameters<typeof StatusBadge>[0]['status']}
                        className="inline-flex"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatMoney(displayTotal)}
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/siparisler/${order.id}`}>
                        <Button variant="outline" size="sm">
                          Yönet
                        </Button>
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Sayfa {page} / {totalPages}
        </p>
        <div className="flex gap-2">
          <Link
            href={`/siparisler${buildQueryString({
              tab: currentTab,
              q: q || undefined,
              from: from || undefined,
              to: to || undefined,
              page: page > 1 ? page - 1 : 1,
            })}`}
            aria-disabled={page <= 1}
          >
            <Button variant="ghost" size="sm" disabled={page <= 1}>
              Önceki
            </Button>
          </Link>
          <Link
            href={`/siparisler${buildQueryString({
              tab: currentTab,
              q: q || undefined,
              from: from || undefined,
              to: to || undefined,
              page: page < totalPages ? page + 1 : totalPages,
            })}`}
            aria-disabled={page >= totalPages}
          >
            <Button variant="ghost" size="sm" disabled={page >= totalPages}>
              Sonraki
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
