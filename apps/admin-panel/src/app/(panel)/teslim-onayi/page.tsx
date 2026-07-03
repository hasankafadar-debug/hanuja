import type { Metadata } from 'next'
import type { OrderStatus, Prisma } from '@prisma/client'
import { PageHeader } from '@hanuja/ui'
import { maskCustomerName } from '@hanuja/security'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { UrlPagination } from '@/components/url-pagination'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { QueueConfirm } from './_components/queue-confirm'

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

  const prisma = createPrismaForRoute()

  // Yesterday or earlier — gives cargo at least 1 day to settle.
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 1)

  const eligibleStatuses: OrderStatus[] = ['shipped', 'delivered', 'delivery_confirmation_pending']

  const where: Prisma.OrderLineWhereInput = {
    deliveryConfirmedAt: null,
    order: {
      shippedAt: { lt: cutoff },
      status: { in: eligibleStatuses },
    },
  }

  const [lines, total] = await Promise.all([
    prisma.orderLine.findMany({
      where,
      orderBy: [{ order: { shippedAt: 'asc' } }, { createdAt: 'asc' }],
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        productName: true,
        quantity: true,
        order: {
          select: {
            id: true,
            publicNumber: true,
            shippedAt: true,
            status: true,
            customer: { select: { name: true } },
            shipments: { select: { cargoProvider: true }, take: 1, orderBy: { createdAt: 'desc' } },
          },
        },
        seller: { select: { id: true, displayName: true } },
      },
    }),
    prisma.orderLine.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teslim Onayı Bekleyenler"
        description={`${total} kalem — kargoya verildikten 1+ gün geçmiş, henüz teslim onayı bekleniyor`}
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
          lines={lines.map((l) => ({
            id: l.id,
            productName: l.productName,
            quantity: l.quantity,
            orderId: l.order.id,
            orderNumber: formatOrderDisplayNumber(l.order.publicNumber, l.order.id),
            shippedAt: l.order.shippedAt!.toISOString(),
            status: l.order.status,
            customerName: maskCustomerName(l.order.customer?.name ?? ''),
            sellerName: l.seller?.displayName ?? '—',
            cargoProvider: l.order.shipments[0]?.cargoProvider ?? '—',
          }))}
        />
      )}

      <div className="flex justify-end">
        <UrlPagination page={page} totalPages={totalPages} />
      </div>
    </div>
  )
}
