import type { Metadata } from 'next'
import type { OrderStatus } from '@prisma/client'
import Link from 'next/link'
import { Button, PageHeader, StatusBadge } from '@hanuja/ui'
import { Download } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createFulfillmentRiskService } from '@hanuja/api/services/fulfillment-risk.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import {
  buildDateRange,
  getPagination,
  getPrimaryStatusValue,
  parseAdminListParams,
  type RawAdminSearchParams,
} from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Siparisler' }

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Taslak' },
  { value: 'checkout_started', label: 'Ödeme başladı' },
  { value: 'payment_pending', label: 'Ödeme bekliyor' },
  { value: 'bank_transfer_waiting', label: 'Havale bekliyor' },
  { value: 'bank_transfer_confirmed', label: 'Havale onaylandı' },
  { value: 'payment_confirmed', label: 'Ödeme onaylandı' },
  { value: 'payment_failed', label: 'Ödeme başarısız' },
  { value: 'payment_cancelled', label: 'Ödeme iptal' },
  { value: 'seller_queue_ready', label: 'Satici kuyrugu' },
  { value: 'seller_reviewing', label: 'Satici inceliyor' },
  { value: 'seller_accepted', label: 'Satici onayladi' },
  { value: 'seller_rejected', label: 'Satici reddetti' },
  { value: 'preparing', label: 'Hazirlaniyor' },
  { value: 'awaiting_shipment', label: 'Kargo bekliyor' },
  { value: 'shipped', label: 'Kargoda' },
  { value: 'delivered', label: 'Teslim edildi' },
  { value: 'delivery_confirmation_pending', label: 'Teslim onayi bekliyor' },
  { value: 'delivery_confirmed', label: 'Teslim onaylandi' },
  { value: 'cancelled_by_customer', label: 'Musteri iptali' },
  { value: 'cancelled_by_admin', label: 'Admin iptali' },
  { value: 'cancelled_due_to_payment_failure', label: 'Ödeme nedeniyle iptal' },
  { value: 'cancelled_due_to_seller_rejection', label: 'Satici reddi iptali' },
  { value: 'cancelled_due_to_20day_breach', label: '20 gun ihlali iptali' },
  { value: 'return_requested', label: 'Iade talep edildi' },
  { value: 'return_under_review', label: 'Iade inceleniyor' },
  { value: 'return_approved', label: 'Iade onaylandi' },
  { value: 'return_rejected', label: 'Iade reddedildi' },
  { value: 'return_in_transit', label: 'Iade kargoda' },
  { value: 'return_received', label: 'Iade alindi' },
  { value: 'refund_pending', label: 'Geri odeme bekliyor' },
  { value: 'refund_completed', label: 'Geri odeme tamamlandi' },
  { value: 'dispute_open', label: 'Uyusmazlik acik' },
  { value: 'dispute_resolved', label: 'Uyusmazlik cozuldu' },
]

const INVOICE_OPTIONS = [
  { value: 'missing', label: 'Faturasi olmayanlar' },
  { value: 'present', label: 'Faturasi olanlar' },
]

function buildExportHref(params: {
  q: string
  status: string[]
  invoice: string
  seller: string
  from: string
  to: string
}) {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status.length > 0) search.set('status', params.status.join(','))
  if (params.invoice) search.set('invoice', params.invoice)
  if (params.seller) search.set('seller', params.seller)
  if (params.from) search.set('from', params.from)
  if (params.to) search.set('to', params.to)
  search.set('format', 'csv')
  return `/api/admin/orders?${search.toString()}`
}

function normalizeInvoiceFilter(value: string): 'missing' | 'present' | undefined {
  return value === 'missing' || value === 'present' ? value : undefined
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const prisma = createPrismaForRoute()
  await createFulfillmentRiskService({ prisma }).refreshActiveRisks()
  const svc = createOrderService({ prisma })
  const invoiceFilter = normalizeInvoiceFilter(params.invoice)
  const result = await svc.listForAdmin({
    ...(params.status.length > 0 ? { status: params.status as OrderStatus[] } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...(invoiceFilter ? { invoice: invoiceFilter } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  type OrderRow = {
    id: string
    publicNumber?: number | null
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{
      seller: { displayName?: string | null; profile?: { companyName?: string | null } | null } | null
      product: { name: string } | null
    }>
    payments: Array<{ method: string; status: string }>
    sellerInvoices: Array<{ id: string }>
    fulfillmentRisk: { status: string; deadlineAt: Date } | null
  }

  const rows = result.rows as unknown as OrderRow[]
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))
  const exportHref = buildExportHref(params)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Siparisler"
        description={`${result.total} siparis`}
        actions={
          <Link href={exportHref}>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" />
              Excel indir
            </Button>
          </Link>
        }
      />

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Siparis, musteri veya urun ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        invoiceValue={params.invoice}
        invoiceOptions={INVOICE_OPTIONS}
        sellerValue={params.seller}
        sellerPlaceholder="Satici ID"
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showSellerFilter
      />

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Siparis yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Siparis No', 'Satici', 'Tutar', 'Durum', 'Fatura', 'Tarih', ''].map((heading) => (
                  <th
                    key={heading}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--color-muted-fg)' }}
                  >
                    {heading}
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
                const sellerName = order.lines[0]?.seller?.displayName ?? order.lines[0]?.seller?.profile?.companyName ?? '-'
                const isDelayRisk = order.fulfillmentRisk?.status === 'warning' || order.fulfillmentRisk?.status === 'breached'
                const riskDeadline = order.fulfillmentRisk?.deadlineAt
                  ? new Date(order.fulfillmentRisk.deadlineAt)
                  : null
                const riskLabel = riskDeadline
                  ? order.fulfillmentRisk?.status === 'breached'
                    ? `Süre geçti: ${riskDeadline.toLocaleDateString('tr-TR')}`
                    : `Son sevk: ${riskDeadline.toLocaleDateString('tr-TR')}`
                  : 'Risk'

                return (
                  <tr
                    key={order.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{
                      borderColor: 'var(--color-border)',
                      backgroundColor: isDelayRisk ? '#fffbeb' : undefined,
                    }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${order.id}`}
                        className="font-medium hover:underline"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        {formatOrderDisplayNumber(order.publicNumber, order.id)}
                      </Link>
                      {isDelayRisk && (
                        <span className="ml-2 text-xs" style={{ color: '#f59e0b' }}>
                          {riskLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {sellerName}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      TRY {amount.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status as never} />
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {order.sellerInvoices.length > 0 ? `${order.sellerInvoices.length} fatura` : 'Yok'}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(order.createdAt).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${order.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Detay
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
