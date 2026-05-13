import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { Users } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createCustomerSupportTicketService } from '@hanuja/api/services/customer-support-ticket.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UrlPagination } from '@/components/url-pagination'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri Destek',
  robots: { index: false, follow: false },
}

type SupportTicketStatus = 'waiting_for_admin' | 'waiting_for_customer' | 'resolved'

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  waiting_for_admin: 'İnceleniyor',
  waiting_for_customer: 'Yanıt bekleniyor',
  resolved: 'Çözümlendi',
}

const STATUS_STYLES: Record<SupportTicketStatus, { bg: string; color: string }> = {
  waiting_for_admin: { bg: '#fffbeb', color: '#92400e' },
  waiting_for_customer: { bg: '#eff6ff', color: '#1e40af' },
  resolved: { bg: '#f0fdf4', color: '#166534' },
}

const CATEGORY_LABELS: Record<string, string> = {
  shipping_delay: 'Kargo gecikmesi',
  damaged_product: 'Ürün hasarlı',
  wrong_product: 'Yanlış ürün',
  invoice_issue: 'Fatura sorunu',
  payment_issue: 'Ödeme sorunu',
  return_or_exchange: 'İade & Değişim',
  other: 'Diğer',
}

const FILTER_TABS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Tümü' },
  { value: 'waiting_for_admin', label: 'İnceleniyor' },
  { value: 'waiting_for_customer', label: 'Yanıt bekleniyor' },
  { value: 'resolved', label: 'Çözümlendi' },
]

const PAGE_SIZE = 30

function maskCustomerName(fullName: string | null | undefined): string {
  if (!fullName) return 'Müşteri'
  const parts = fullName.trim().split(' ')
  if (parts.length === 1) return parts[0] ?? 'Müşteri'
  return `${parts[0] ?? ''} ${parts[1]?.[0] ?? ''}.`
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusChip({ status }: { status: string }) {
  const s = status as SupportTicketStatus
  const label = STATUS_LABELS[s] ?? status
  const style = STATUS_STYLES[s] ?? { bg: 'var(--color-muted)', color: 'var(--color-muted-fg)' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
      {label}
    </span>
  )
}

export default async function CustomerSupportListPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await getAdminSession()

  const resolved = searchParams ? await searchParams : {}
  const rawStatus = Array.isArray(resolved.status) ? resolved.status[0] : resolved.status
  const rawPage = Array.isArray(resolved.page) ? resolved.page[0] : resolved.page
  const page = Math.max(1, parseInt(rawPage ?? '1', 10))
  const skip = (page - 1) * PAGE_SIZE

  const validStatuses: SupportTicketStatus[] = [
    'waiting_for_admin',
    'waiting_for_customer',
    'resolved',
  ]
  const statusFilter = validStatuses.includes(rawStatus as SupportTicketStatus)
    ? (rawStatus as SupportTicketStatus)
    : undefined

  const svc = createCustomerSupportTicketService({ prisma: createPrismaForRoute() })
  const { items, total } = await svc.listForAdmin({
    take: PAGE_SIZE,
    skip,
    ...(statusFilter ? { status: statusFilter } : {}),
  })

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const activeTab = statusFilter ?? 'all'

  function buildTabHref(value: string) {
    const params = new URLSearchParams()
    if (value !== 'all') params.set('status', value)
    const str = params.toString()
    return `/musteri-destek${str ? `?${str}` : ''}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Müşteri Destek"
        description={`${total} talep`}
      />

      {/* Filtre sekmeleri */}
      <div className="flex flex-wrap gap-2">
        {FILTER_TABS.map((tab) => {
          const isActive = activeTab === tab.value
          return (
            <Link
              key={tab.value}
              href={buildTabHref(tab.value)}
              className="rounded-full border px-4 py-2 text-sm font-medium transition-colors"
              style={{
                borderColor: isActive ? 'var(--color-accent)' : 'var(--color-border)',
                backgroundColor: isActive ? 'var(--color-muted)' : 'transparent',
                color: isActive ? 'var(--color-primary)' : 'var(--color-muted-fg)',
              }}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Tablo */}
      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full whitespace-nowrap text-sm">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Müşteri', 'Sipariş #', 'Kategori', 'Durum', 'Son Mesaj', 'Çözümleyen', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {statusFilter
                    ? 'Bu filtrede talep bulunamadı.'
                    : 'Henüz müşteri destek talebi yok.'}
                </td>
              </tr>
            )}
            {items.map((ticket) => {
              const maskedName = maskCustomerName(ticket.customer?.name)
              const orderNum = ticket.order?.publicNumber
                ? `#${ticket.order.publicNumber}`
                : ticket.orderId.slice(-8).toUpperCase()
              const categoryLabel = CATEGORY_LABELS[ticket.category] ?? ticket.category

              return (
                <tr
                  key={ticket.id}
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                    {maskedName}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/siparisler/${ticket.orderId}`}
                      className="font-mono text-xs hover:underline"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      {orderNum}
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {categoryLabel}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={ticket.status} />
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {ticket.lastCustomerMessageAt
                      ? formatDate(ticket.lastCustomerMessageAt)
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {ticket.status === 'resolved' && ticket.resolvedBy?.name
                      ? ticket.resolvedBy.name
                      : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/musteri-destek/${ticket.id}`}
                      className="text-xs hover:underline"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      İncele
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </div>
  )
}
