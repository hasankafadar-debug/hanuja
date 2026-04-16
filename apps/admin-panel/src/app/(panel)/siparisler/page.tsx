import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Siparişler' }

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000

export default async function AdminOrdersPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const svc = createOrderService({ prisma })
  const orders = await svc.listForAdmin({ skip: 0, take: 50 })

  type OrderRow = {
    id: string
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{
      seller: { profile: { storeName: string } | null } | null
      product: { name: string } | null
    }>
    payments: Array<{ method: string; status: string }>
  }

  const rows = orders as unknown as OrderRow[]
  const now = Date.now()

  return (
    <div className="space-y-6">
      <PageHeader title="Siparişler" description={`${rows.length} sipariş`} />

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Sipariş yok.
          </p>
        ) : (
          <table className="w-full text-sm whitespace-nowrap">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş No', 'Satıcı', 'Tutar', 'Durum', 'Tarih', ''].map((h) => (
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
              {rows.map((order) => {
                const amount =
                  typeof order.totalAmount === 'number'
                    ? order.totalAmount
                    : order.totalAmount.toNumber()
                const sellerName = order.lines[0]?.seller?.profile?.storeName ?? '—'
                const ageMs = now - new Date(order.createdAt).getTime()
                const isDelayRisk =
                  ageMs > TWENTY_DAYS_MS &&
                  ['seller_accepted', 'preparing', 'awaiting_shipment', 'seller_queue_ready'].includes(order.status)

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
                        {order.id.slice(-10).toUpperCase()}
                      </Link>
                      {isDelayRisk && (
                        <span className="ml-2 text-xs" style={{ color: '#f59e0b' }}>
                          ⚠ Risk
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {sellerName}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      ₺{amount.toLocaleString('tr-TR')}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status as never} />
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(order.createdAt).toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${order.id}`}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--color-accent)' }}
                      >
                        Detay →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
