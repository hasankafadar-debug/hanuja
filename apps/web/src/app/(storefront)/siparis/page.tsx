import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { StatusBadge, EmptyState } from '@hanuja/ui'
import { Package } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Siparişlerim',
  description: 'Tüm siparişlerinizi takip edin.',
  robots: { index: false, follow: false },
}

async function getOrders(customerId: string) {
  try {
    const svc = createOrderService({ prisma: createPrismaForRoute() })
    return await svc.listForCustomer(customerId, 0, 20)
  } catch {
    return []
  }
}

export default async function OrdersPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris?redirect=/siparis')
  }

  const orders = await getOrders(session.user.id)

  if (orders.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
        <EmptyState
          icon={<Package className="h-12 w-12" />}
          title="Henüz siparişiniz yok"
          description="İlk alışverişinizi yapın ve siparişlerinizi buradan takip edin."
          action={
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-white"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              Alışverişe Başla
            </Link>
          }
        />
      </div>
    )
  }

  type OrderRow = {
    id: string
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{ product: { name: string } | null }>
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <h1
        className="mb-8 text-2xl font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-primary)' }}
      >
        Siparişlerim
      </h1>

      <div className="space-y-4">
        {(orders as OrderRow[]).map((order) => {
          const total =
            typeof order.totalAmount === 'object'
              ? order.totalAmount.toNumber()
              : Number(order.totalAmount)
          const itemNames = order.lines
            .slice(0, 2)
            .map((l) => l.product?.name ?? 'Ürün')
            .join(', ')
          const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })

          return (
            <Link key={order.id} href={`/siparis/${order.id}`}>
              <div
                className="rounded-xl border p-5 transition-shadow hover:shadow-md"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold font-mono text-sm" style={{ color: 'var(--color-primary)' }}>
                      #{order.id.slice(-8).toUpperCase()}
                    </p>
                    <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>{date}</p>
                    <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      {itemNames}
                      {order.lines.length > 2 ? ` ve ${order.lines.length - 2} ürün daha` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
                    <span className="font-semibold text-sm" style={{ color: 'var(--color-primary)' }}>
                      ₺{total.toLocaleString('tr-TR')}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
