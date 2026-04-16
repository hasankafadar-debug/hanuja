import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, StatusBadge, PageHeader, Separator } from '@hanuja/ui'
import { ArrowLeft, Truck, MapPin, AlertTriangle } from 'lucide-react'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import ShipmentForm from './_components/shipment-form'
import RejectButton from './_components/reject-button'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Sipariş #${id.slice(-8).toUpperCase()}` }
}

export default async function SellerOrderDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession()

  const svc = createOrderService({ prisma: createPrismaForRoute() })
  const order = await svc.getOrderForSeller(id, seller.id)

  if (!order) notFound()

  type OrderLine = {
    id: string
    quantity: number
    unitPrice: { toNumber(): number } | number
    product: { id: string; name: string; slug: string } | null
  }
  type Shipment = {
    id: string
    trackingNumber: string | null
    status: string
  }

  const lines = order.lines as unknown as OrderLine[]
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const latestShipment = shipments[0]

  const grossAmount = lines.reduce((sum, l) => {
    const price = typeof l.unitPrice === 'object' ? l.unitPrice.toNumber() : Number(l.unitPrice)
    return sum + price * l.quantity
  }, 0)

  // 15% commission placeholder — real rate comes from payout record when created
  const commissionRate = 0.15
  const commission = Math.round(grossAmount * commissionRate)
  const netAmount = grossAmount - commission

  const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  // 20-day deadline from payment confirmation
  const paymentConfirmedAt = (order as { paymentConfirmedAt?: Date | null }).paymentConfirmedAt
  let deadlineText: string | null = null
  let daysLeft: number | null = null
  if (paymentConfirmedAt) {
    const deadline = new Date(paymentConfirmedAt)
    deadline.setDate(deadline.getDate() + 20)
    daysLeft = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    deadlineText = deadline.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  }

  const canShip = ['seller_queue_ready', 'seller_accepted', 'preparing', 'awaiting_shipment'].includes(order.status)
  const canReject = ['seller_queue_ready', 'seller_reviewing'].includes(order.status)

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/siparisler" className="mb-3 inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          <ArrowLeft className="h-4 w-4" /> Siparişlere Dön
        </Link>
        <div className="flex items-center justify-between">
          <PageHeader
            title={`Sipariş #${id.slice(-8).toUpperCase()}`}
            description={date}
          />
          <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
        </div>
      </div>

      {/* 20-day deadline warning */}
      {deadlineText && daysLeft !== null && daysLeft <= 10 && (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#f59e0b', backgroundColor: '#fffbeb' }}
        >
          <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#92400e' }}>
              Kargo Son Tarihi: {deadlineText}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#92400e' }}>
              {daysLeft > 0
                ? `Kalan süre: ${daysLeft} gün. 20 günlük taahhüt aşılırsa %20 ceza uygulanabilir.`
                : 'Kargo süresi dolmuş! Admin incelemesinde.'}
            </p>
          </div>
        </div>
      )}

      {/* Order items */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>Ürünler</h2>
        <div className="space-y-3">
          {lines.map((line) => {
            const price = typeof line.unitPrice === 'object' ? line.unitPrice.toNumber() : Number(line.unitPrice)
            return (
              <div key={line.id} className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm" style={{ color: 'var(--color-primary)' }}>
                    {line.product?.name ?? 'Ürün'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>{line.quantity} adet</p>
                </div>
                <span className="font-medium text-sm" style={{ color: 'var(--color-primary)' }}>
                  ₺{(price * line.quantity).toLocaleString('tr-TR')}
                </span>
              </div>
            )
          })}
        </div>
        <Separator className="my-4" />
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
            <span>Brüt tutar</span>
            <span>₺{grossAmount.toLocaleString('tr-TR')}</span>
          </div>
          <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
            <span>Komisyon (%{Math.round(commissionRate * 100)})</span>
            <span>-₺{commission.toLocaleString('tr-TR')}</span>
          </div>
          <div className="flex justify-between font-semibold" style={{ color: 'var(--color-primary)' }}>
            <span>Net Hakediş (tahmini)</span>
            <span>₺{netAmount.toLocaleString('tr-TR')}</span>
          </div>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          * Net hakediş, teslimat onayından itibaren 30 gün sonra ödenir.
        </p>
      </section>

      {/* Delivery address */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <h2 className="mb-3 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
          <MapPin className="h-4 w-4" /> Teslimat Adresi
        </h2>
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {(order as { shippingAddress?: string | null }).shippingAddress ?? 'Adres bilgisi mevcut değil.'}
        </p>
      </section>

      {/* Existing tracking */}
      {latestShipment?.trackingNumber && (
        <section className="rounded-xl border p-5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <h2 className="mb-3 font-semibold flex items-center gap-2" style={{ color: 'var(--color-primary)' }}>
            <Truck className="h-4 w-4" /> Kargo Takip
          </h2>
          <p className="font-mono text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {latestShipment.trackingNumber}
          </p>
        </section>
      )}

      {/* Shipment form */}
      {canShip && (
        <ShipmentForm orderId={id} />
      )}

      {/* Reject */}
      {canReject && (
        <div className="flex justify-end">
          <RejectButton orderId={id} />
        </div>
      )}
    </div>
  )
}
