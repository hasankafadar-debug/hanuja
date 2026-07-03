import type { Metadata } from 'next'
import type { DisputeStatus } from '@prisma/client'
import Link from 'next/link'
import { Button, StatusBadge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createDisputeService } from '@hanuja/api/services/dispute.service'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Uyuşmazlıklar' }

const STATUS_OPTIONS = [
  { value: 'open', label: 'Açık' },
  { value: 'under_review', label: 'İncelemede' },
  { value: 'resolved_for_customer', label: 'Müşteri lehine' },
  { value: 'resolved_for_seller', label: 'Satıcı lehine' },
]

export default async function DisputesAdminPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const prisma = createPrismaForRoute()
  const service = createDisputeService({ prisma })
  const result = await service.listForAdmin({
    ...(params.status.length > 0 ? { status: params.status as DisputeStatus[] } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))
  const sellerIds = [...new Set(result.rows.flatMap((dispute) => dispute.order?.lines.map((line) => line.sellerId) ?? []))]
  const sellers = sellerIds.length > 0
    ? await prisma.seller.findMany({
        where: { id: { in: sellerIds } },
        select: { id: true, displayName: true },
      })
    : []
  const sellerMap = new Map(sellers.map((seller) => [seller.id, seller.displayName]))
  const openCount = await prisma.dispute.count({ where: { status: { in: ['open', 'under_review'] } } })

  return (
    <div className="space-y-6">
      <PageHeader title="Uyuşmazlıklar" description={`${openCount} açık uyuşmazlık`} />

      <div className="flex gap-2">
        <Link
          href="/uyusmazliklar?status=open,under_review"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
        >
          Açık / İncelemede
        </Link>
        <Link
          href="/uyusmazliklar?status=resolved_for_customer,resolved_for_seller,closed"
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
        >
          Sonuçlananlar
        </Link>
      </div>

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Önemli:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          Açık uyuşmazlıklar ilgili siparişin hakedişini bloke eder. Müşteri lehine çözümde ödeme iadesi
          tetiklenir; satıcı lehine çözümde hakediş serbest kalır.
        </span>
      </div>

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Uyuşmazlık, sipariş veya müşteri ara"
        statusValue={getPrimaryStatusValue(params.status)}
        statusOptions={STATUS_OPTIONS}
        sellerValue={params.seller}
        sellerPlaceholder="Satıcı ID"
        fromValue={params.from}
        toValue={params.to}
        pageSize={params.pageSize}
        showSellerFilter
      />

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Uyuşmazlık', 'Sipariş', 'Satıcı', 'Müşteri', 'Sebep', 'Açılış', 'Durum', ''].map((heading) => (
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
            {result.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Henüz uyuşmazlık yok.
                </td>
              </tr>
            )}
            {result.rows.map((dispute) => {
              const sellerId = dispute.order?.lines[0]?.sellerId
              const sellerName = sellerId ? (sellerMap.get(sellerId) ?? '—') : '—'
              const customerName = dispute.order?.customer?.name ?? '—'
              return (
                <tr
                  key={dispute.id}
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {dispute.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/siparisler/${dispute.orderId}`}
                      className="font-medium hover:underline"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      {dispute.orderId.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {sellerName}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {customerName}
                  </td>
                  <td
                    className="max-w-[180px] px-4 py-3 truncate"
                    style={{ color: 'var(--color-muted-fg)' }}
                    title={dispute.reason}
                  >
                    {dispute.reason}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {dispute.createdAt.toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={dispute.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/uyusmazliklar/${dispute.id}`}>
                      <Button size="sm" variant="outline">İncele</Button>
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <UrlPagination page={params.page} totalPages={totalPages} />
      </div>
    </div>
  )
}
