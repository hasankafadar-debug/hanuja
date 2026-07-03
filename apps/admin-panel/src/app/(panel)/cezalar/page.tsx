import type { Metadata } from 'next'
import type { PenaltyStatus } from '@prisma/client'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { WaivePenaltyButton } from '@/components/waive-penalty-button'
import { IssueSellerInvoiceButton } from '@/components/issue-seller-invoice-button'
import { EditInvoiceDialog, EditPenaltyDialog } from '@/components/edit-invoice-dialog'
import { createPenaltyService } from '@hanuja/api/services/penalty.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { formatMoney } from '@hanuja/security'
import {
  buildDateRange,
  getPagination,
  getPrimaryStatusValue,
  parseAdminListParams,
  type RawAdminSearchParams,
} from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Cezalar' }

const REASON_MAP: Record<string, string> = {
  seller_rejected_paid_order: 'Siparis reddi',
  fulfillment_20day_breach: '20 gun taahhut ihlali',
  late_shipment_daily_accrual: 'Gunluk gec sevkiyat cezasi',
  other: 'Diger',
}

const STATUS_OPTIONS = [
  { value: 'applied', label: 'Uygulandi' },
  { value: 'waived', label: 'Muaf tutuldu' },
  { value: 'offset', label: 'Mahsup edildi' },
]

function readPenaltyTab(
  searchParams: RawAdminSearchParams | undefined,
): 'unbilled' | 'billed' | 'waived' {
  const tabRaw = searchParams?.tab
  const tabValue = Array.isArray(tabRaw) ? tabRaw[0] : tabRaw
  if (tabValue === 'unbilled' || tabValue === 'billed' || tabValue === 'waived') {
    return tabValue
  }

  const billingRaw = searchParams?.billing
  const billingValue = Array.isArray(billingRaw) ? billingRaw[0] : billingRaw
  if (billingValue === 'present') return 'billed'
  if (billingValue === 'missing') return 'unbilled'
  return 'unbilled'
}

type PenaltyRow = {
  id: string
  orderId: string
  sellerId: string
  reason: string
  status: string
  penaltyAmount: { toNumber(): number } | number
  createdAt: Date
  waivedBy?: string | null
  waivedAt?: Date | null
  waiverReason?: string | null
  seller: { displayName: string; profile: { storeName: string } | null } | null
  financeInvoices: Array<{
    id: string
    invoiceNumber: string
    invoiceDate: Date
    invoiceCategory: string | null
    description: string | null
    grossInvoiceAmount: { toNumber(): number } | number
    payoutId: string | null
  }>
}

export default async function PenaltiesPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })
  const currentTab = readPenaltyTab(resolvedSearchParams)

  const prisma = createPrismaForRoute()
  const svc = createPenaltyService({ prisma })
  const result = await svc.listForAdmin({
    ...(params.status[0] ? { status: params.status[0] as PenaltyStatus } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    tab: currentTab,
    ...buildDateRange(params),
    ...getPagination(params),
  })

  const rows = result.rows as unknown as PenaltyRow[]
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))

  const uniqueOrderIds = [...new Set(rows.map((row) => row.orderId))]
  const orderPublicNumberMap = new Map<string, number | null>()
  if (uniqueOrderIds.length > 0) {
    const orderRows = await prisma.order.findMany({
      where: { id: { in: uniqueOrderIds } },
      select: { id: true, publicNumber: true },
    })
    for (const row of orderRows) {
      orderPublicNumberMap.set(row.id, row.publicNumber)
    }
  }

  const waivedAdminIds = [...new Set(rows.map((row) => row.waivedBy).filter(Boolean) as string[])]
  const waivedAdminMap = new Map<string, string>()
  if (waivedAdminIds.length > 0) {
    const admins = await prisma.user.findMany({
      where: { id: { in: waivedAdminIds } },
      select: { id: true, name: true, email: true },
    })
    for (const admin of admins) {
      waivedAdminMap.set(admin.id, admin.name ?? admin.email ?? admin.id)
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-penalties-page">
      <PageHeader title="Cezalar" description={`${result.total} ceza kaydi`} />

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'unbilled', label: 'Faturalandirilmamis' },
          { key: 'billed', label: 'Faturalandirilmis' },
          { key: 'waived', label: 'Muaflar' },
        ].map((tab) => {
          const next = new URLSearchParams()
          next.set('tab', tab.key)
          if (params.q) next.set('q', params.q)
          if (params.status.length > 0) next.set('status', params.status.join(','))
          if (params.seller) next.set('seller', params.seller)
          if (params.from) next.set('from', params.from)
          if (params.to) next.set('to', params.to)
          if (params.pageSize !== 20) next.set('pageSize', String(params.pageSize))

          const active = currentTab === tab.key
          return (
            <Link
              key={tab.key}
              href={`/cezalar?${next.toString()}`}
              className="rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={{
                borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: active ? 'var(--color-muted)' : 'transparent',
                color: active ? 'var(--color-primary)' : 'var(--color-muted-fg)',
              }}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Standard penalty rules:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          Seller rejection remains a fixed 20% penalty. Late shipment now accrues 1% per day and the order auto-cancels on the 20th breach day.
        </span>
      </div>

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Siparis veya satici ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
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
            Ceza kaydi yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Siparis', 'Satici', 'Tutar', 'Sebep', 'Tarih', 'Durum', ''].map((heading) => (
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
              {rows.map((penalty) => {
                const amount =
                  typeof penalty.penaltyAmount === 'number'
                    ? penalty.penaltyAmount
                    : penalty.penaltyAmount.toNumber()
                const storeName =
                  penalty.seller?.profile?.storeName ??
                  penalty.seller?.displayName ??
                  penalty.sellerId.slice(0, 8)
                const waived = penalty.status === 'waived'
                const orderDisplayNumber = formatOrderDisplayNumber(
                  orderPublicNumberMap.get(penalty.orderId),
                  penalty.orderId,
                )

                return (
                  <tr
                    key={penalty.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/siparisler/${penalty.orderId}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {orderDisplayNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/saticilar/${penalty.sellerId}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {storeName}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: waived ? 'var(--color-muted-fg)' : 'var(--color-destructive)' }}
                    >
                      {waived ? <s>{formatMoney(amount)}</s> : formatMoney(amount)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {REASON_MAP[penalty.reason] ?? penalty.reason}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(penalty.createdAt).toLocaleDateString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium"
                        style={{ color: waived ? 'var(--color-success)' : 'var(--color-destructive)' }}
                      >
                        {waived ? 'Muaf tutuldu' : 'Uygulandi'}
                      </span>
                      {waived ? (
                        <div className="mt-1 space-y-1 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          <p>{waivedAdminMap.get(penalty.waivedBy ?? '') ?? 'Admin'} tarafindan muaf tutuldu</p>
                          {penalty.waivedAt ? (
                            <p>
                              {new Date(penalty.waivedAt).toLocaleDateString('tr-TR', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                          ) : null}
                          {penalty.waiverReason ? <p>{penalty.waiverReason}</p> : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {!waived && penalty.financeInvoices.length === 0 ? (
                        <div className="flex gap-2">
                          <EditPenaltyDialog
                            penaltyId={penalty.id}
                            amount={amount.toFixed(2)}
                            reason={penalty.reason}
                          />
                          <WaivePenaltyButton penaltyId={penalty.id} />
                          <IssueSellerInvoiceButton
                            sellerId={penalty.sellerId}
                            type="penalty"
                            sourcePenaltyId={penalty.id}
                            sourceOrderId={penalty.orderId}
                            orderNumber={orderDisplayNumber}
                            defaultDescription={`Ceza faturasi: ${orderDisplayNumber}`}
                            defaultAmount={String(amount)}
                            buttonLabel="Faturalandir"
                          />
                        </div>
                      ) : penalty.financeInvoices[0] ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                            {penalty.financeInvoices[0].invoiceNumber}
                          </span>
                          {!penalty.financeInvoices[0].payoutId ? (
                            <EditInvoiceDialog
                              invoiceId={penalty.financeInvoices[0].id}
                              invoiceNumber={penalty.financeInvoices[0].invoiceNumber}
                              invoiceDate={penalty.financeInvoices[0].invoiceDate.toISOString()}
                              invoiceCategory={penalty.financeInvoices[0].invoiceCategory}
                              description={penalty.financeInvoices[0].description}
                              grossInvoiceAmount={String(
                                typeof penalty.financeInvoices[0].grossInvoiceAmount === 'number'
                                  ? penalty.financeInvoices[0].grossInvoiceAmount
                                  : penalty.financeInvoices[0].grossInvoiceAmount.toNumber(),
                              )}
                              type="penalty"
                            />
                          ) : null}
                        </div>
                      ) : !waived ? (
                        <EditPenaltyDialog
                          penaltyId={penalty.id}
                          amount={amount.toFixed(2)}
                          reason={penalty.reason}
                        />
                      ) : null}
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
