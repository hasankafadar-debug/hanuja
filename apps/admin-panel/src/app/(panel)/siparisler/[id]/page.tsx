import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, LegalDocumentDialog, PageHeader, Separator, StatusBadge } from '@hanuja/ui'
import { formatMoney } from '@hanuja/security'
import { AlertTriangle, ArrowLeft, Download, FileText } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { createFulfillmentRiskService } from '@hanuja/api/services/fulfillment-risk.service'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { AdminOrderActions } from '@/components/admin-order-actions'
import { CancellationDetailCard } from './_components/cancellation-detail-card'
import { PerLineDeliveryConfirm } from './_components/per-line-delivery-confirm'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function moneyToNumber(value: { toNumber(): number } | number | null | undefined) {
  if (!value) return 0
  return typeof value === 'object' && 'toNumber' in value ? value.toNumber() : Number(value)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const prisma = createPrismaForRoute()
  const order = await prisma.order.findUnique({
    where: { id },
    select: { publicNumber: true },
  })
  return { title: `Sipariş ${formatOrderDisplayNumber(order?.publicNumber, id)}` }
}

const TERMINAL_STATUSES = new Set([
  'cancelled_by_customer',
  'cancelled_by_admin',
  'cancelled_due_to_payment_failure',
  'cancelled_due_to_seller_rejection',
  'cancelled_due_to_20day_breach',
  'refund_completed',
  'dispute_resolved',
])

const DELIVERY_CONFIRMABLE = new Set([
  'delivered',
  'delivery_confirmation_pending',
  'shipped',
])

const BLOCKABLE_PAYOUT_STATUSES = new Set(['hold_active', 'payout_ready', 'payout_scheduled'])

export default async function AdminOrderDetailPage({ params }: Props) {
  await getAdminSession()

  const { id } = await params
  const prisma = createPrismaForRoute()
  const [platformSettings] = await Promise.all([
    createPlatformSettingsService({ prisma }).get(),
    createFulfillmentRiskService({ prisma }).refreshActiveRisks(),
  ])

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
      legalSnapshot: true,
      sellerInvoices: {
        include: {
          seller: { select: { id: true, displayName: true, slug: true } },
        },
        orderBy: [{ uploadedAt: 'desc' }, { createdAt: 'desc' }],
      },
      payouts: { orderBy: { createdAt: 'desc' } },
      penalties: { orderBy: { createdAt: 'desc' } },
      fulfillmentRisks: {
        where: { status: { in: ['warning', 'breached'] } },
        orderBy: [{ deadlineAt: 'asc' }, { createdAt: 'desc' }],
        include: {
          orderLine: {
            select: { id: true, productName: true, quantity: true },
          },
        },
      },
    },
  })

  if (!order) notFound()

  const total = moneyToNumber(order.totalAmount)
  const grossAmount = moneyToNumber(order.grossAmount)
  const shippingAmount = moneyToNumber(order.shippingAmount)
  const eftDiscountAmount = moneyToNumber(order.eftDiscountAmount)

  const isTerminal = TERMINAL_STATUSES.has(order.status)
  const canConfirmDelivery = DELIVERY_CONFIRMABLE.has(order.status)
  const hasEftPendingPayment = order.payments.some((payment) => payment.method === 'eft' && payment.status === 'pending')
  const hasBlockablePayout = order.payouts.some((payout) => BLOCKABLE_PAYOUT_STATUSES.has(payout.status))
  const canCancel = !isTerminal

  const primaryRisk = order.fulfillmentRisks[0] ?? null
  const isDelayRisk = primaryRisk?.status === 'warning' || primaryRisk?.status === 'breached'
  const shipmentDeadline = primaryRisk?.deadlineAt
    ? new Date(primaryRisk.deadlineAt).toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null
  const riskTitle = primaryRisk?.status === 'breached'
    ? 'Kargo sınırı aşıldı'
    : 'Kargo sınırı yaklaşıyor'

  const payment = order.payments[0] ?? null
  const shipment = order.shipments[0] ?? null
  const sellerName = order.lines[0]?.seller?.displayName ?? '—'
  const sellerId = order.lines[0]?.seller?.id ?? null
  const sellerLineTotal = order.lines
    .filter((line) => line.seller?.id === sellerId)
    .reduce((sum, line) => {
      const value =
        typeof line.totalPrice === 'object' && 'toNumber' in line.totalPrice
          ? line.totalPrice.toNumber()
          : Number(line.totalPrice)
      return sum + value
    }, 0)
  const canApplyManualPenalty = sellerId !== null && order.penalties.length === 0
  const distanceSalesDownloadHref = `/api/admin/orders/${order.id}/contracts/distance-sales`
  const preInformationDownloadHref = `/api/admin/orders/${order.id}/contracts/pre-information`

  return (
    <div className="max-w-3xl space-y-6">
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
            title={`Sipariş ${formatOrderDisplayNumber(order.publicNumber, order.id)}`}
            description={new Date(order.createdAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          />
          <StatusBadge status={order.status as never} />
        </div>
      </div>

      {isDelayRisk && shipmentDeadline ? (
        <div
          className="flex items-start gap-3 rounded-xl border p-4"
          style={{ borderColor: '#fca5a5', backgroundColor: '#fff5f5' }}
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--color-destructive)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#7f1d1d' }}>
              {riskTitle}: {shipmentDeadline}
            </p>
            <p className="mt-0.5 text-xs" style={{ color: '#7f1d1d' }}>
              Sistem yalnızca admine bilgi verir. Gecikme olursa manuel ceza değerlendirmesi admin tarafında yapılır.
            </p>
            {primaryRisk?.orderLine ? (
              <p className="mt-1 text-xs" style={{ color: '#7f1d1d' }}>
                Riskli satır: {primaryRisk.orderLine.productName} x {primaryRisk.orderLine.quantity}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ürünler ve Finans
          </h2>
          <div className="space-y-2">
            {order.lines.map((line) => (
              <div key={line.id} className="text-sm">
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-muted-fg)' }}>
                    {line.productName} × {line.quantity}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                    {formatMoney(
                      typeof line.totalPrice === 'object'
                        ? line.totalPrice.toNumber()
                        : Number(line.totalPrice),
                    )}
                  </span>
                </div>
                {line.deliveryConfirmedAt ? (
                  <p className="mt-0.5 text-xs" style={{ color: 'var(--color-success)' }}>
                    ✓ Teslim onaylandı — {new Date(line.deliveryConfirmedAt).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          <Separator className="my-3" />

          <div className="space-y-1 text-sm">
            {[
              { label: 'Urunler', value: formatMoney(grossAmount) },
              ...(eftDiscountAmount > 0
                ? [{ label: 'EFT indirimi', value: `-${formatMoney(eftDiscountAmount)}` }]
                : []),
              {
                label: 'Kargo',
                value: shippingAmount === 0 ? 'Ucretsiz' : formatMoney(shippingAmount),
              },
              { label: 'Toplam tutar', value: formatMoney(total) },
              {
                label: 'Ödeme yöntemi',
                value: payment ? (payment.method === 'eft' ? 'Havale / EFT' : 'Kredi kartı') : '—',
              },
              { label: 'Ödeme durumu', value: payment?.status ?? '—' },
              {
                label: 'Ödeme onayı',
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
              { label: 'Müşteri', value: order.customer.name ?? order.customer.email },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-4">
                <span style={{ color: 'var(--color-muted-fg)' }}>{label}</span>
                <span style={{ color: 'var(--color-primary)' }}>{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Olay Geçmişi
          </h2>
          {order.statusHistory.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Kayıt yok.
            </p>
          ) : (
            <ol className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {order.statusHistory.map((event, index) => (
                <li key={event.id} className="flex gap-3 text-sm">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        index === order.statusHistory.length - 1
                          ? 'var(--color-accent)'
                          : 'var(--color-muted-fg)',
                    }}
                  />
                  <div>
                    <p style={{ color: 'var(--color-primary)' }}>{event.toStatus}</p>
                    <p style={{ color: 'var(--color-muted-fg)' }}>
                      {new Date(event.createdAt).toLocaleString('tr-TR', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {event.note ? ` · ${event.note}` : ''}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {shipment ? (
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Kargo Bilgisi
          </h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              { label: 'Kargo firması', value: shipment.cargoProvider ?? '—' },
              { label: 'Takip no', value: shipment.trackingNumber ?? '—' },
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
      ) : null}

      {order.address ? (
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
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
      ) : null}

      {(order.legalSnapshot || order.sellerInvoices.length > 0) ? (
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <div className="mb-4 flex items-center gap-2">
            <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
              Belgeler
            </h2>
          </div>

          {order.legalSnapshot ? (
            <div className="mb-4 flex flex-wrap gap-2">
              <LegalDocumentDialog
                title="Mesafeli Satış Sözleşmesi"
                html={order.legalSnapshot.distanceSalesHtml}
                triggerLabel="Mesafeli Satış Sözleşmesi"
                triggerVariant="outline"
                downloadHref={distanceSalesDownloadHref}
              />
              <LegalDocumentDialog
                title="Ön Bilgilendirme Formu"
                html={order.legalSnapshot.preInformationHtml}
                triggerLabel="Ön Bilgilendirme Formu"
                triggerVariant="outline"
                downloadHref={preInformationDownloadHref}
              />
            </div>
          ) : null}

          {order.sellerInvoices.length > 0 ? (
            <div className="space-y-3">
              {order.sellerInvoices.map((invoice) => {
                const viewHref = `/api/admin/orders/${order.id}/invoices/${invoice.sellerId}`
                const downloadHref = `${viewHref}?download=1`
                const uploadedAt = new Date(invoice.uploadedAt).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div
                    key={invoice.id}
                    className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {invoice.seller.displayName}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {invoice.fileName} · {uploadedAt}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={viewHref}>Görüntüle</a>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={downloadHref}>
                          <Download className="h-4 w-4" />
                          İndir
                        </a>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Satıcı faturası henüz yüklenmedi.
            </p>
          )}
        </section>
      ) : null}

      {order.payouts.length > 0 ? (
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Hakediş Durumu
          </h2>
          <div className="space-y-2 text-sm">
            {order.payouts.map((payout) => {
              const net =
                typeof payout.netAmount === 'object'
                  ? payout.netAmount.toNumber()
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
                    {formatMoney(net)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {order.penalties.length > 0 ? (
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ceza Kayıtları
          </h2>
          <div className="space-y-2 text-sm">
            {order.penalties.map((penalty) => {
              const amount =
                typeof penalty.penaltyAmount === 'object'
                  ? penalty.penaltyAmount.toNumber()
                  : Number(penalty.penaltyAmount)
              return (
                <div key={penalty.id} className="flex justify-between">
                  <span style={{ color: 'var(--color-muted-fg)' }}>
                    {penalty.reason} · {penalty.status}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-destructive)' }}>
                    {formatMoney(amount)}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <CancellationDetailCard
        cancellationReason={order.cancellationReason}
        cancelledAt={order.cancelledAt}
        orderStatus={order.status}
        statusHistory={order.statusHistory}
        penalties={order.penalties}
      />

      <PerLineDeliveryConfirm
        orderId={order.id}
        lines={order.lines.map((l) => ({
          id: l.id,
          productName: l.productName,
          quantity: l.quantity,
          deliveryConfirmedAt: l.deliveryConfirmedAt ?? null,
        }))}
        canConfirm={canConfirmDelivery}
      />

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
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
          manualPenalty={canApplyManualPenalty && sellerId
            ? {
                sellerId,
                sellerName,
                defaultAmount: (sellerLineTotal * platformSettings.standardPenaltyRate.toNumber()).toFixed(2),
              }
            : null}
        />
        <p className="mt-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
          Tüm admin işlemleri denetim günlüğüne kaydedilir.
        </p>
      </section>
    </div>
  )
}
