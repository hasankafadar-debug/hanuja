import type { Metadata } from 'next'
import type { PenaltyStatus } from '@prisma/client'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { WaivePenaltyButton } from '@/components/waive-penalty-button'
import { createPenaltyService } from '@hanuja/api/services/penalty.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AdminListControls } from '@/components/admin-list-controls'
import { UrlPagination } from '@/components/url-pagination'
import { buildDateRange, getPagination, getPrimaryStatusValue, parseAdminListParams, type RawAdminSearchParams } from '@/lib/admin-list-params'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Cezalar' }

const REASON_MAP: Record<string, string> = {
  seller_rejected_paid_order: 'Sipariş reddi',
  fulfillment_20day_breach: '20 gün taahhüt ihlali',
  other: 'Diğer',
}

const STATUS_OPTIONS = [
  { value: 'applied', label: 'Uygulandı' },
  { value: 'waived', label: 'Muaf tutuldu' },
  { value: 'offset', label: 'Mahsup edildi' },
]

export default async function PenaltiesPage({
  searchParams,
}: {
  searchParams?: Promise<RawAdminSearchParams>
}) {
  await getAdminSession()

  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const params = parseAdminListParams(resolvedSearchParams, { pageSize: 20 })

  const prisma = createPrismaForRoute()
  const svc = createPenaltyService({ prisma })
  const result = await svc.listForAdmin({
    ...(params.status[0] ? { status: params.status[0] as PenaltyStatus } : {}),
    ...(params.q ? { query: params.q } : {}),
    ...(params.seller ? { sellerId: params.seller } : {}),
    ...buildDateRange(params),
    ...getPagination(params),
  })

  type PenaltyRow = {
    id: string
    orderId: string
    sellerId: string
    reason: string
    status: string
    penaltyAmount: { toNumber(): number } | number
    createdAt: Date
    seller: { displayName: string; profile: { storeName: string } | null } | null
  }

  const rows = result.rows as unknown as PenaltyRow[]
  const totalPages = Math.max(1, Math.ceil(result.total / params.pageSize))

  return (
    <div className="space-y-6" data-testid="admin-penalties-page">
      <PageHeader title="Cezalar" description={`${result.total} ceza kaydı`} />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Standart ceza oranı:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          Ürün tutarının %20&apos;si. Satıcı cari hesabına borç kaydedilir ve gelecek hakedişlerden mahsup edilir.
          İstisnai durumlarda yetkili admin muafiyet uygulayabilir.
        </span>
      </div>

      <AdminListControls
        searchValue={params.q}
        searchPlaceholder="Sipariş veya satıcı ara"
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
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Ceza kaydı yok.
          </p>
        ) : (
          <table className="w-full whitespace-nowrap text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş', 'Satıcı', 'Tutar', 'Sebep', 'Tarih', 'Durum', ''].map((heading) => (
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
                      <Link
                        href={`/siparisler/${penalty.orderId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {penalty.orderId.slice(-8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/saticilar/${penalty.sellerId}`}
                        className="hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        {storeName}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3 font-medium"
                      style={{ color: waived ? 'var(--color-muted-fg)' : 'var(--color-destructive)' }}
                    >
                      {waived ? <s>₺{amount.toLocaleString('tr-TR')}</s> : `₺${amount.toLocaleString('tr-TR')}`}
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
                      {waived ? (
                        <span className="text-xs font-medium" style={{ color: 'var(--color-success)' }}>
                          Muaf tutuldu
                        </span>
                      ) : (
                        <span className="text-xs font-medium" style={{ color: 'var(--color-destructive)' }}>
                          Uygulandı
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!waived && <WaivePenaltyButton penaltyId={penalty.id} />}
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
