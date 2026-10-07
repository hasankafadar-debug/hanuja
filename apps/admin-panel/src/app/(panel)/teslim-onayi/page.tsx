import type { Metadata } from 'next'
import { PageHeader } from '@hanuja/ui'
import { maskCustomerName } from '@hanuja/security'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UrlPagination } from '@/components/url-pagination'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { QueueConfirm } from './_components/queue-confirm'
import { createAdminDeliveryQueryService } from '@hanuja/api/services/admin-delivery-query.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Teslim Onayı Bekleyenler' }

const PAGE_SIZE = 50

function getPage(searchParams?: Record<string, string | string[] | undefined>): number {
  const raw = searchParams?.page
  const value = Array.isArray(raw) ? raw[0] : raw
  const parsed = Number.parseInt(value ?? '1', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export default async function TeslimOnayiPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await getAdminSession()
  const resolved = searchParams ? await searchParams : undefined
  const page = getPage(resolved)
  const skip = (page - 1) * PAGE_SIZE

  const sellerReported = resolved?.sellerReported === '1'

  const prisma = createPrismaForRoute()

  const { lines, orderCount, lineCount } = await createAdminDeliveryQueryService({
    prisma,
  }).listForAdmin({
    sellerReported,
      skip,
      take: PAGE_SIZE,
  })
  const totalPages = Math.max(1, Math.ceil(lineCount / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <PageHeader
        title={sellerReported ? 'Satıcı Teslim Bildirimleri' : 'Teslim Onayı Bekleyenler'}
        description={`${orderCount} sipariş, ${lineCount} kalem — ${sellerReported ? 'satıcı teslim bildiriminde bulunmuş, teslim teyidi bekleniyor' : 'sevkten 1+ gün geçmiş, teslim teyidi bekleniyor'}`}
      />

      {lines.length === 0 ? (
        <div
          className="rounded-xl border p-6 text-center text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <p style={{ color: 'var(--color-muted-fg)' }}>Bekleyen teslim onayı yok.</p>
        </div>
      ) : (
        <QueueConfirm
          sellerReported={sellerReported}
          lines={lines.map((l) => ({
            id: l.id,
            productName: l.productName,
            quantity: l.quantity - l.cancelledQuantity,
            orderId: l.order.id,
            orderNumber: formatOrderDisplayNumber(l.order.publicNumber, l.order.id),
            shippedAt: (
              l.fulfilledAt ??
              l.order.shippedAt ??
              l.sellerDeliveryReportedAt!
            ).toISOString(),
            reportedAt: l.sellerDeliveryReportedAt?.toISOString() ?? null,
            status: l.order.status,
            customerName: maskCustomerName(l.order.customer?.name ?? ''),
            sellerName: l.seller?.displayName ?? '—',
            cargoProvider:
              l.order.shipments.find((shipment) => shipment.sellerId === l.sellerId)
                ?.cargoProvider ?? '—',
            trackingNumber:
              l.order.shipments.find((shipment) => shipment.sellerId === l.sellerId)
                ?.trackingNumber ?? '—',
          }))}
        />
      )}

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </div>
  )
}
