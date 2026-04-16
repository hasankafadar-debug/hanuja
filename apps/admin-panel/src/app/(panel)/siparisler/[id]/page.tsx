import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, StatusBadge, PageHeader, Separator } from '@hanuja/ui'
import { ArrowLeft, AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { AdminOrderActions } from '@/components/admin-order-actions'

export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return { title: `Sipariş ${id.slice(-8).toUpperCase()}` }
}

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000

/** Status'ları iptal/tamamlanmış olarak kabul eden liste */
const TERMINAL_STATUSES = new Set([
  'cancelled_by_customer',
  'cancelled_by_admin',
  'cancelled_due_to_payment_failure',
  'cancelled_due_to_seller_rejection',
  'cancelled_due_to_20day_breach',
  'refund_completed',
  'dispute_resolved',
])

/** Teslim onayı için uygun durumlar */
const DELIVERY_CONFIRMABLE = new Set([
  'delivered',
  'delivery_confirmation_pending',
  'shipped',
])

/** Bloke edilebilir payout durumları */
const BLOCKABLE_PAYOUT_STATUSES = new Set(['hold_active', 'payout_ready', 'payout_scheduled'])

export default async function AdminOrderDetailPage({ params }: Props) {
  await getAdminSession()

  const { id } = await params
  const prisma = createPrismaForRoute()

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      address: true,
      lines: {
        include: {
          product: { select: { id: true, name: true, slug: true } },
          seller: { select: { id: true, displayName: true, slug: true } },
        },
      },
      payments: { orderBy: { createdAt: 'desc' } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      statusHistory: { orderBy: { createdAt: 'asc' } },
      payouts: { orderBy: { createdAt: 'desc' } },
      penalties: { orderBy: { createdAt: 'desc' } },
    },
  })

  if (!order) notFound()

  const total =
    typeof order.totalAmount === 'object' && 'toNumber' in order.totalAmount
      ? (order.totalAmount as { toNumber(): number }).toNumber()
      : Number(order.totalAmount)

  const isTerminal = TERMINAL_STATUSES.has(order.status)
  const canConfirmDelivery = DELIVERY_CONFIRMABLE.has(order.status)
  const hasEftPendingPayment = order.payments.some(
    (p) => p.method === 'eft' && p.status === 'pending',
  )
  const hasBlockablePayout = order.payouts.some((p) =>
    BLOCKABLE_PAYOUT_STATUSES.has(p.status),
  )
  const canCancel = !isTerminal

  // 20 günlük risk hesabı
  const ageMs = Date.now() - new Date(order.createdAt).getTime()
  const isDelayRisk =
    ageMs > TWENTY_DAYS_MS &&
    ['seller_accepted', 'preparing', 'awaiting_shipment', 'seller_queue_ready'].includes(
      order.status,
    )

  const shipmentDeadline = order.paymentConfirmedAt
    ? new Date(new Date(order.paymentConfirmedAt).getTime() + TWENTY_DAYS_MS).toLocaleDateString(
        'tr-TR',
        { day: 'numeric', month: 'long', year: 'numeric' },
      )
    : null

  const payment = order.payments[0] ?? null
  const shipment = order.shipments[0] ?? null

  // Satıcı adı — ilk line'dan
  const sellerName = order.lines[0]?.seller?.displayName ?? '—'
  const sellerId = order.lines[0]?.seller?.id ?? null

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/siparisler"
          className="mb-3 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Siparişlere Dön
        </Link>
        <div className="flex items-center justify-between">
          <PageHeader
            title={`Sipariş #${order.id.slice(-8).toUpperCase()}`}
            description={new Date(order.createdAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          />
          <StatusBadge status={order.status as never} />
        </div>
      </div>

      {/* Gecikme uyarısı */}
      {isDelayRisk && shipmentDeadline && (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#fca5a5', backgroundColor: '#fff5f5' }}
        >
          <AlertTriangle
            className="h-5 w-5 mt-0.5 shrink-0"
            style={{ color: 'var(--color-destructive)' }}
          />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#7f1d1d' }}>
              Kargo Sınırı Aşımı Riski: {shipmentDeadline}
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#7f1d1d' }}>
              20 gün taahhüdü aşılırsa otomatik ceza değerlendirmesi başlar.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Ürünler & Finans */}
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ürünler & Finans
          </h2>
          <div className="space-y-2">
            {order.lines.map((line) => (
              <div key={line.id} className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-muted-fg)' }}>
                  {line.productName} × {line.quantity}
                </span>
                <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                  ₺
                  {(typeof line.totalPrice === 'object'
                    ? (line.totalPrice as { toNumber(): number }).toNumber()
                    : Number(line.totalPrice)
                  ).toLocaleString('tr-TR')}
                </span>
              </div>
            ))}
          </div>

          <Separator className="my-3" />

          <div className="space-y-1 text-sm">
            {[
              {
                label: 'Toplam Tutar',
                value: `₺${total.toLocaleString('tr-TR')}`,
              },
              {
                label: 'Ödeme Yöntemi',
                value: payment
                  ? payment.method === 'eft'
                    ? 'Havale / EFT'
                    : 'Kredi Kartı'
                  : '—',
              },
              {
                label: 'Ödeme Durumu',
                value: payment?.status ?? '—',
              },
              {
                label: 'Ödeme Onayı',
                value: order.paymentConfirmedAt
                  ? new Date(order.paymentConfirmedAt).toLocaleString('tr-TR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—',
              },
              {
                label: 'Satıcı',
                value: sellerId ? (
                  <Link
                    href={`/saticilar/${sellerId}`}
                    className="hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {sellerName}
                  </Link>
                ) : (
                  sellerName
                ),
              },
              {
                label: 'Müşteri',
                value: order.customer.name ?? order.customer.email,
              },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between">
                <span style={{ color: 'var(--color-muted-fg)' }}>{label}</span>
                <span style={{ color: 'var(--color-primary)' }}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Olay Geçmişi */}
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Olay Geçmişi
          </h2>
          {order.statusHistory.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Kayıt yok.
            </p>
          ) : (
            <ol className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {order.statusHistory.map((e, i) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        i === order.statusHistory.length - 1
                          ? 'var(--color-accent)'
                          : 'var(--color-muted-fg)',
                    }}
                  />
                  <div>
                    <p style={{ color: 'var(--color-primary)' }}>{e.toStatus}</p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(e.createdAt).toLocaleString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Kargo */}
      {shipment && (
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Kargo Bilgisi
          </h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { label: 'Kargo Firması', value: shipment.cargoProvider ?? '—' },
              { label: 'Takip No', value: shipment.trackingNumber ?? '—' },
              { label: 'Durum', value: shipment.status },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {label}
                </p>
                <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Teslimat Adresi */}
      {order.address && (
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Teslimat Adresi
          </h2>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {order.address.fullName} · {order.address.phone}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {order.address.addressLine1}
            {order.address.addressLine2 ? `, ${order.address.addressLine2}` : ''}
            {', '}
            {order.address.district} / {order.address.city}
          </p>
        </section>
      )}

      {/* Payout durumu */}
      {order.payouts.length > 0 && (
        <section
          className="rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Hakediş Durumu
          </h2>
          <div className="space-y-2 text-sm">
            {order.payouts.map((payout) => {
              const net =
                typeof payout.netAmount === 'object'
                  ? (payout.netAmount as { toNumber(): number }).toNumber()
                  : Number(payout.netAmount)
              return (
                <div key={payout.id} className="flex justify-between">
                  <span style={{ color: 'var(--color-muted-fg)' }}>
                    {payout.status}
                    {payout.holdUntil
                      ? ` · Bekleme: ${new Date(payout.holdUntil).toLocaleDateString('tr-TR')}`
                      : ''}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    ₺{net.toLocaleString('tr-TR')}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Admin İşlemleri */}
      <section
        className="rounded-xl border p-5"
        style={{
          borderColor: 'var(--color-border)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
          Admin İşlemleri
        </h2>
        <AdminOrderActions
          orderId={order.id}
          canConfirmDelivery={canConfirmDelivery}
          hasEftPendingPayment={hasEftPendingPayment}
          hasBlockablePayout={hasBlockablePayout}
          canCancel={canCancel}
        />
        <p className="mt-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Tüm admin işlemleri denetim günlüğüne kaydedilir.
        </p>
      </section>
    </div>
  )
}
