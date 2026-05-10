import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader, StatCard } from '@hanuja/ui'
import { Wallet, Clock, Lock, CheckCircle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { ReleasePayoutButton } from '@/components/release-payout-button'
import { createPayoutService } from '@hanuja/api/services/payout.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Hakedisler' }

const STATUS_OPTIONS = [
  { value: 'payout_ready', label: 'Vadesi dolan' },
  { value: 'hold_active', label: 'Hold aktif' },
  { value: 'payout_blocked', label: 'Bloklu' },
  { value: 'payout_paid', label: 'Odenenler' },
]

const TAB_CONFIG = [
  { key: 'payout_ready', label: 'Vadesi Dolan' },
  { key: 'hold_active', label: 'Hold Aktif' },
  { key: 'payout_blocked', label: 'Bloklu' },
  { key: 'payout_paid', label: 'Odenenler' },
] as const

type PayoutRow = {
  id: string
  orderId: string
  sellerId: string
  status: string
  netAmount: { toNumber(): number } | number
  blockedReason: string | null
  seller: {
    displayName: string | null
    profile: { storeName: string | null } | null
    bankDetails: Array<{
      iban: string
      accountHolder: string
      bankName: string
    }>
  } | null
  order: {
    id: string
    publicNumber: number | null
    createdAt: Date
    shippedAt: Date | null
    deliveryConfirmedAt: Date | null
    totalAmount: { toNumber(): number } | number
  } | null
}

function formatAmount(value: number) {
  return `TRY ${value.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDate(value: Date | null | undefined) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default async function PayoutsAdminPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const prisma = createPrismaForRoute()
  const svc = createPayoutService({ prisma })

  const selectedStatus = params.status[0] || 'payout_ready'

  const [payouts, summary] = await Promise.all([
    svc.listForAdmin({
      status: selectedStatus as never,
      ...buildDateRange(params),
      ...getPagination(params),
    }),
    Promise.all([
      prisma.payout.aggregate({ where: { status: 'payout_ready' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'hold_active' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'payout_blocked' }, _sum: { netAmount: true } }),
      prisma.payout.aggregate({ where: { status: 'payout_paid' }, _sum: { netAmount: true } }),
      prisma.payout.count({ where: { status: selectedStatus as never, ...buildDateRange(params) } }),
    ]),
  ])

  const [readyAgg, holdAgg, blockedAgg, paidAgg, totalCount] = summary
  const rows = payouts as unknown as PayoutRow[]
  const totalPages = Math.max(1, Math.ceil(totalCount / params.pageSize))

  return (
    <div className="space-y-8" data-testid="admin-payouts-page">
      <PageHeader title="Hakedisler" description="Satici payout takibi, hold durumu ve odeme kayitlari" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Vadesi Dolan"
          value={formatAmount(Number(readyAgg._sum.netAmount ?? 0))}
          icon={<CheckCircle className="h-5 w-5" />}
        />
        <StatCard
          title="Hold Aktif"
          value={formatAmount(Number(holdAgg._sum.netAmount ?? 0))}
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Bloklu"
          value={formatAmount(Number(blockedAgg._sum.netAmount ?? 0))}
          icon={<Lock className="h-5 w-5" />}
        />
        <StatCard
          title="Odenenler"
          value={formatAmount(Number(paidAgg._sum.netAmount ?? 0))}
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {TAB_CONFIG.map((tab) => {
          const next = new URLSearchParams()
          next.set('status', tab.key)
          if (params.from) next.set('from', params.from)
          if (params.to) next.set('to', params.to)
          if (params.pageSize !== 20) next.set('pageSize', String(params.pageSize))

          const active = selectedStatus === tab.key
          return (
            <Link
              key={tab.key}
              href={`/hakedisler?${next.toString()}`}
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

      <AdminListControls
        statusValue={getPrimaryStatusValue([selectedStatus])}
        statusOptions={STATUS_OPTIONS}
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showDateRange
      />

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Hakedis kaydi yok.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Satici', 'Siparis No', 'Siparis Tarihi', 'Sevk Tarihi', 'Siparis Tutari', 'Net Tutar', 'Teslim Onayi', 'Blok Sebebi', 'Durum', ''].map((heading) => (
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
              {rows.map((payout) => {
                const netAmount = typeof payout.netAmount === 'number' ? payout.netAmount : payout.netAmount.toNumber()
                const grossAmount = payout.order
                  ? (typeof payout.order.totalAmount === 'number'
                    ? payout.order.totalAmount
                    : payout.order.totalAmount.toNumber())
                  : 0
                const storeName = payout.seller?.profile?.storeName ?? payout.seller?.displayName ?? payout.sellerId.slice(0, 8)
                const bankDetail = payout.seller?.bankDetails[0] ?? null
                const orderLabel = payout.order
                  ? formatOrderDisplayNumber(payout.order.publicNumber, payout.order.id)
                  : payout.orderId.slice(-8).toUpperCase()

                return (
                  <tr
                    key={payout.id}
                    className="border-t hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/saticilar/${payout.sellerId}`}
                        className="hover:underline font-medium"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {storeName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${payout.orderId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {orderLabel}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatDate(payout.order?.createdAt)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatDate(payout.order?.shippedAt)}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatAmount(grossAmount)}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatAmount(netAmount)}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatDate(payout.order?.deliveryConfirmedAt)}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-destructive)' }}>
                      {payout.blockedReason ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={payout.status as never} />
                    </td>
                    <td className="px-4 py-3">
                      {payout.status === 'payout_ready' && (
                        <ReleasePayoutButton
                          payoutId={payout.id}
                          orderNumber={orderLabel}
                          netAmount={formatAmount(netAmount)}
                          iban={bankDetail?.iban ?? payout.sellerId}
                          accountHolder={bankDetail?.accountHolder ?? storeName}
                          defaultBankName={bankDetail?.bankName ?? ''}
                        />
                      )}
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
