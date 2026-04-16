import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Breadcrumb, StatusBadge, Separator } from '@hanuja/ui'
import { Package, MapPin, CreditCard } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Sipariş #${id.slice(-8).toUpperCase()}`,
    robots: { index: false, follow: false },
  }
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect(`/giris?redirect=/siparis/${id}`)
  }

  let order
  try {
    const svc = createOrderService({ prisma: createPrismaForRoute() })
    order = await svc.getOrderForCustomer(id, session.user.id)
  } catch {
    order = null
  }

  if (!order) notFound()

  type OrderLine = {
    id: string
    quantity: number
    unitPrice: { toNumber(): number } | number
    product: { id: string; name: string; slug: string; images: Array<{ url: string }> } | null
  }

  type Shipment = {
    id: string
    trackingNumber: string | null
    status: string
    createdAt: Date
  }

  const lines = order.lines as unknown as OrderLine[]
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const subtotal = lines.reduce((s, l) => {
    const price = typeof l.unitPrice === 'object' ? l.unitPrice.toNumber() : Number(l.unitPrice)
    return s + price * l.quantity
  }, 0)

  const latestShipment = shipments[0]
  const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const breadcrumbItems = [
    { label: 'Anasayfa', href: '/' },
    { label: 'Siparişlerim', href: '/siparis' },
    { label: `#${id.slice(-8).toUpperCase()}` },
  ]

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Breadcrumb items={breadcrumbItems} className="mb-8" />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono" style={{ color: 'var(--color-primary)' }}>
            Sipariş #{id.slice(-8).toUpperCase()}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>{date}</p>
        </div>
        <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
      </div>

      {/* Order items */}
      <section
        className="rounded-xl border p-5 mb-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="mb-4 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
          <Package className="h-4 w-4" /> Ürünler
        </h2>
        <div className="space-y-4">
          {lines.map((line) => {
            const price = typeof line.unitPrice === 'object' ? line.unitPrice.toNumber() : Number(line.unitPrice)
            const image = line.product?.images?.[0]?.url
            return (
              <div key={line.id} className="flex items-center gap-3">
                <div
                  className="h-14 w-14 shrink-0 rounded-lg overflow-hidden flex items-center justify-center text-xs"
                  style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                >
                  {image ? (
                    <img src={image} alt={line.product?.name} className="h-full w-full object-cover" />
                  ) : (
                    'Görsel'
                  )}
                </div>
                <div className="flex-1">
                  {line.product?.slug ? (
                    <Link
                      href={`/urun/${line.product.slug}`}
                      className="text-sm font-medium hover:underline"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {line.product.name}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {line.product?.name ?? 'Ürün'}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>{line.quantity} adet</p>
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  ₺{(price * line.quantity).toLocaleString('tr-TR')}
                </span>
              </div>
            )
          })}
        </div>
        <Separator className="my-4" />
        <div className="flex justify-between text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          <span>Toplam</span>
          <span>₺{subtotal.toLocaleString('tr-TR')}</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {/* Delivery address */}
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
            <MapPin className="h-4 w-4" /> Teslimat Adresi
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
            {(order as { shippingAddress?: string | null }).shippingAddress ?? 'Adres bilgisi mevcut değil.'}
          </p>
        </section>

        {/* Tracking */}
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
            <CreditCard className="h-4 w-4" /> Kargo Takip
          </h2>
          {latestShipment?.trackingNumber ? (
            <p className="text-sm font-mono" style={{ color: 'var(--color-muted-fg)' }}>
              {latestShipment.trackingNumber}
            </p>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz kargo bilgisi yok.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
