import type { Metadata } from 'next'
import type { ExtensionRequestStatus } from '@prisma/client'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { isMissingDatabaseObjectError } from '@hanuja/api/lib/prisma-runtime'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { getAdminSession } from '@/lib/admin-session'
import { UrlPagination } from '@/components/url-pagination'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ek Sure Talepleri' }

const STATUS_LABELS: Record<ExtensionRequestStatus, string> = {
  pending_admin_review: 'Admin Incelemesi Bekliyor',
  awaiting_customer_decision: 'Musteri Yaniti Bekleniyor',
  awaiting_seller_followup: 'Saticidan Bilgi Bekleniyor',
  approved: 'Onaylandi',
  rejected_by_admin: 'Admin Reddetti',
  rejected_by_customer: 'Musteri Reddetti',
}

const STATUS_COLORS: Record<ExtensionRequestStatus, { bg: string; fg: string }> = {
  pending_admin_review: { bg: '#fef3c7', fg: '#92400e' },
  awaiting_customer_decision: { bg: '#dbeafe', fg: '#1e3a8a' },
  awaiting_seller_followup: { bg: '#fce7f3', fg: '#9d174d' },
  approved: { bg: '#dcfce7', fg: '#166534' },
  rejected_by_admin: { bg: '#fee2e2', fg: '#991b1b' },
  rejected_by_customer: { bg: '#fee2e2', fg: '#991b1b' },
}

const PAGE_SIZE = 30

function getActiveStatus(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.status
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value && value in STATUS_LABELS) return value as ExtensionRequestStatus
  return 'all' as const
}

function getPage(searchParams?: Record<string, string | string[] | undefined>) {
  const raw = searchParams?.page
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export default async function UzatmaTalepleriPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await getAdminSession()
  const resolved = searchParams ? await searchParams : undefined
  const statusFilter = getActiveStatus(resolved)
  const page = getPage(resolved)
  const skip = (page - 1) * PAGE_SIZE
  const prisma = createPrismaForRoute()
  const where = statusFilter === 'all' ? {} : { status: statusFilter }

  let rows: Array<{
    id: string
    requestedDays: number
    sellerReason: string
    status: ExtensionRequestStatus
    approvedDays: number | null
    createdAt: Date
    order: { id: string; publicNumber: number | null }
    seller: { id: string; displayName: string } | null
  }> = []
  let total = 0
  let schemaReady = true

  try {
    ;[rows, total] = await Promise.all([
      prisma.fulfillmentExtensionRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE_SIZE,
        select: {
          id: true,
          requestedDays: true,
          sellerReason: true,
          status: true,
          approvedDays: true,
          createdAt: true,
          order: { select: { id: true, publicNumber: true } },
          seller: { select: { id: true, displayName: true } },
        },
      }),
      prisma.fulfillmentExtensionRequest.count({ where }),
    ])
  } catch (error) {
    if (
      isMissingDatabaseObjectError(error, {
        tableNames: ['fulfillment_extension_requests'],
      })
    ) {
      schemaReady = false
      rows = []
      total = 0
      console.warn(
        '[admin] fulfillment_extension_requests tablosu hazir degil; extension listesi gecici olarak bos dondu.',
      )
    } else {
      throw error
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const tabs: Array<{ value: ExtensionRequestStatus | 'all'; label: string }> = [
    { value: 'all', label: 'Tumu' },
    { value: 'pending_admin_review', label: 'Admin Bekleniyor' },
    { value: 'awaiting_customer_decision', label: 'Musteri Bekleniyor' },
    { value: 'awaiting_seller_followup', label: 'Satici Bekleniyor' },
    { value: 'approved', label: 'Onaylanmis' },
    { value: 'rejected_by_admin', label: 'Admin Reddetti' },
    { value: 'rejected_by_customer', label: 'Musteri Reddetti' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Ek Sure Talepleri" description={`${total} kayit`} />

      {!schemaReady ? (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb', color: '#92400e' }}
        >
          Ek sure talepleri tablosu bu ortamda henuz hazir degil. Migration tamamlandiginda bu
          liste otomatik dolacak.
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`?status=${tab.value}`}
            className="rounded-full border px-3 py-1.5 text-xs font-medium"
            style={{
              backgroundColor:
                statusFilter === tab.value ? 'var(--color-primary)' : 'var(--color-surface)',
              color: statusFilter === tab.value ? '#fff' : 'var(--color-muted-fg)',
              borderColor: 'var(--color-border)',
            }}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {schemaReady
              ? 'Bu filtreye uyan ek sure talebi yok.'
              : 'Veri tablo kurulumu tamamlanana kadar gosterilemiyor.'}
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Tarih', 'Siparis', 'Satici', 'Talep', 'Onaylanan', 'Durum', 'Sebep', 'Aksiyon'].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const color = STATUS_COLORS[row.status]
                return (
                  <tr
                    key={row.id}
                    className="border-t"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(row.createdAt).toLocaleString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-primary)' }}>
                      <Link href={`/siparisler/${row.order.id}`} className="hover:underline">
                        {formatOrderDisplayNumber(row.order.publicNumber, row.order.id)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {row.seller ? (
                        <Link
                          href={`/saticilar/${row.seller.id}`}
                          className="hover:underline"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          {row.seller.displayName}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.requestedDays} gun</td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.approvedDays !== null ? `${row.approvedDays} gun` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: color.bg, color: color.fg }}
                      >
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td
                      className="max-w-xs whitespace-normal px-4 py-3"
                      style={{ color: 'var(--color-muted-fg)' }}
                    >
                      {row.sellerReason}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/uzatma-talepleri/${row.id}`}
                        className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-muted)]"
                        style={{
                          borderColor: 'var(--color-border)',
                          color: 'var(--color-primary)',
                        }}
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
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </div>
  )
}
