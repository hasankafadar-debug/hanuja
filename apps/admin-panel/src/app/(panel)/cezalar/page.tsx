import type { Metadata } from 'next'
import type { PenaltyStatus } from '@prisma/client'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { WaivePenaltyButton } from '@/components/waive-penalty-button'
import { IssueSellerInvoiceButton } from '@/components/issue-seller-invoice-button'
import { createPenaltyService } from '@hanuja/api/services/penalty.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

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

function readBillingFilter(searchParams: RawAdminSearchParams | undefined): 'missing' | 'present' | undefined {
  const raw = searchParams?.billing
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'missing' || value === 'present' ? value : undefined
}

type PenaltyRow = {
  id: string
  orderId: string
  sellerId: string
  reason: string
  status: string
  penaltyAmount: { toNumber(): number } | number
  createdAt: Date
  seller: { displayName: string; profile: { storeName: string } | null } | null
  financeInvoices: Array<{ id: string; invoiceNumber: string }>
}

export default async function PenaltiesPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })
  const billingFilter = readBillingFilter(resolvedSearchParams)

  const prisma = createPrismaForRoute()
  const svc = createPenaltyService({ prisma })
  const result = await svc.listForAdmin({
    ...(params.status[0] ? { status: params.status[0] as PenaltyStatus } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...(billingFilter ? { financeInvoice: billingFilter } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  const rows = result.rows as unknown as PenaltyRow[]
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))

  return (
    <div className="space-y-6" data-testid="admin-penalties-page">
      <PageHeader title="Cezalar" description={`${result.total} ceza kaydi`} />

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'missing', label: 'Faturalandirilmamis' },
          { key: 'present', label: 'Faturalandirilmis' },
        ].map((tab) => {
          const next = new URLSearchParams()
          next.set('billing', tab.key)
          if (params.q) next.set('q', params.q)
          if (params.status.length > 0) next.set('status', params.status.join(','))
          if (params.seller) next.set('seller', params.seller)
          if (params.from) next.set('from', params.from)
          if (params.to) next.set('to', params.to)
          if (params.pageSize !== 20) next.set('pageSize', String(params.pageSize))

          const active = billingFilter === tab.key
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
                const amount = typeof penalty.penaltyAmount === 'number'
                  ? penalty.penaltyAmount
                  : penalty.penaltyAmount.toNumber()
                const storeName = penalty.seller?.profile?.storeName ?? penalty.seller?.displayName ?? penalty.sellerId.slice(0, 8)
                const waived = penalty.status === 'waived'

                return (
                  <tr
                    key={penalty.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link href={`/siparisler/${penalty.orderId}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {penalty.orderId.slice(-8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link href={`/saticilar/${penalty.sellerId}`} className="hover:underline" style={{ color: 'var(--color-accent)' }}>
                        {storeName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: waived ? 'var(--color-muted-fg)' : 'var(--color-destructive)' }}>
                      {waived ? <s>TRY {amount.toLocaleString('tr-TR')}</s> : `TRY ${amount.toLocaleString('tr-TR')}`}
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
                    </td>
                    <td className="px-4 py-3">
                      {!waived && penalty.financeInvoices.length === 0 ? (
                        <div className="flex gap-2">
                          <WaivePenaltyButton penaltyId={penalty.id} />
                          <IssueSellerInvoiceButton
                            sellerId={penalty.sellerId}
                            type="penalty"
                            sourcePenaltyId={penalty.id}
                            sourceOrderId={penalty.orderId}
                            orderNumber={penalty.orderId.slice(-8).toUpperCase()}
                            defaultDescription={`Penalty for order ${penalty.orderId.slice(-8).toUpperCase()}`}
                            defaultAmount={String(amount)}
                            buttonLabel="Faturalandir"
                          />
                        </div>
                      ) : penalty.financeInvoices[0] ? (
                        <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                          {penalty.financeInvoices[0].invoiceNumber}
                        </span>
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
