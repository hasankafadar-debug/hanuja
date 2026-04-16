import type { Metadata } from 'next'
import Link from 'next/link'
import { StatusBadge, PageHeader, EmptyState } from '@hanuja/ui'
import { ShoppingBag } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Siparişler' }

export default async function SellerOrdersPage() {
  const { seller } = await getSellerFromSession()

  const svc = createOrderService({ prisma: createPrismaForRoute() })
  const orders = await svc.listForSellerQueue(seller.id, 0, 50)

  type OrderRow = {
    id: string
    createdAt: Date
    status: string
    lines: Array<{
      unitPrice: { toNumber(): number } | number
      quantity: number
      product: { name: string } | null
    }>
  }

  const rows = orders as unknown as OrderRow[]

  return (
    <div className="space-y-6">
      <PageHeader title="Siparişler" description={`${rows.length} sipariş`} />

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {rows.length === 0 ? (
          <div className="p-12">
            <EmptyState
              icon={<ShoppingBag className="h-10 w-10" />}
              title="Henüz sipariş yok"
              description="Ürünlerinize gelen siparişler burada görünecek."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--color-muted)' }}>
              <tr>
                {['Sipariş No', 'Ürün', 'Tarih', 'Durum', 'Tutar'].map((h) => (
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
                const firstProductName = order.lines[0]?.product?.name ?? 'Ürün'
                const extraCount = order.lines.length - 1
                const total = order.lines.reduce((sum, l) => {
                  const price = typeof l.unitPrice === 'object' ? l.unitPrice.toNumber() : Number(l.unitPrice)
                  return sum + price * l.quantity
                }, 0)
                const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })
                return (
                  <tr
                    key={order.id}
                    className="border-t transition-colors hover:bg-[var(--color-muted)]"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/siparisler/${order.id}`}
                        className="font-medium hover:underline font-mono text-xs"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        #{order.id.slice(-8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                      {firstProductName}
                      {extraCount > 0 && (
                        <span className="ml-1 text-xs">+{extraCount} daha</span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{date}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>
                      ₺{total.toLocaleString('tr-TR')}
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
