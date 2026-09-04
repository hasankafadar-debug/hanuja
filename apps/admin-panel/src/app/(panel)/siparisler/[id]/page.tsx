import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, LegalDocumentDialog, PageHeader, Separator, StatusBadge } from '@hanuja/ui'
import { formatMoney } from '@hanuja/security'
import { AlertTriangle, ArrowLeft, Download, FileText } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import { summarizeOrderQuantities } from '@hanuja/api/domain/order-quantity-summary'
import { getManualEftRefundCompletion } from '@hanuja/api/domain/manual-eft-refund'
import { createFulfillmentRiskService } from '@hanuja/api/services/fulfillment-risk.service'
import { createPlatformSettingsService } from '@hanuja/api/services/platform-settings.service'
import { AdminOrderActions } from '@/components/admin-order-actions'
import { CancellationDetailCard } from './_components/cancellation-detail-card'
import { PerLineDeliveryConfirm } from './_components/per-line-delivery-confirm'
import { ManualRefundCompletion } from './_components/manual-refund-completion'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function moneyToNumber(value: { toNumber(): number } | number | null | undefined) {
  if (!value) return 0
  return typeof value === 'object' && 'toNumber' in value ? value.toNumber() : Number(value)
}

const REFUND_STATUS_LABELS: Record<string, string> = {
  pending: 'Bekliyor',
  processing: 'İşleniyor',
  partially_completed: 'Kısmen tamamlandı',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  manual_required: 'Manuel işlem gerekli',
}

const REFUND_SOURCE_LABELS: Record<string, string> = {
  cancellation: 'İptal',
  return_request: 'İade talebi',
  dispute: 'Uyuşmazlık',
}

const REFUND_ITEM_KIND_LABELS: Record<string, string> = {
  product: 'Ürün',
  shipping: 'Kargo',
}

function refundStatusLabel(status: string) {
  return REFUND_STATUS_LABELS[status] ?? status
}

function refundStatusStyle(status: string) {
  if (status === 'completed') {
    return {
      borderColor: '#86efac',
      backgroundColor: '#f0fdf4',
      color: '#166534',
    }
  }
  if (status === 'failed' || status === 'manual_required') {
    return {
      borderColor: '#fca5a5',
      backgroundColor: '#fff5f5',
      color: '#991b1b',
    }
  }
  return {
    borderColor: 'var(--color-border)',
    backgroundColor: 'var(--color-muted)',
    color: 'var(--color-primary)',
  }
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
      cancellations: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          customerRefundAmount: true,
          grossProductAmount: true,
          couponAdjustmentAmount: true,
          sellerAdjustmentAmount: true,
          commissionAdjustmentAmount: true,
          shippingRefundAmount: true,
          createdAt: true,
        },
      },
      refundTransactions: {
        orderBy: { createdAt: 'desc' },
        include: {
          payment: {
            select: {
              orderId: true, method: true, provider: true, status: true,
              amount: true, refundedAmount: true, currency: true,
            },
          },
          items: {
            orderBy: { createdAt: 'asc' },
            include: {
              orderLine: { select: { id: true, productName: true } },
              paymentProviderItem: {
                select: {
                  id: true,
                  providerItemId: true,
                  providerTransactionId: true,
                  kind: true,
                },
              },
            },
          },
        },
      },
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

  const { originalQuantity, currentQuantity, cancelledQuantity, shippedQuantity } =
    summarizeOrderQuantities(order.lines)
  const cancellationGrossProductAmount = order.cancellations.reduce(
    (sum, cancellation) => sum + moneyToNumber(cancellation.grossProductAmount),
    0,
  )
  const refundCancellationGrossProductAmount = order.refundTransactions
    .filter((refund) => refund.sourceType === 'cancellation')
    .reduce((sum, refund) => sum + moneyToNumber(refund.grossProductAmount), 0)
  const cancelledGrossProductAmount =
    cancellationGrossProductAmount > 0
      ? cancellationGrossProductAmount
      : refundCancellationGrossProductAmount

  const refundTotals = order.refundTransactions.reduce(
    (totals, refund) => {
      const hasItems = refund.items.length > 0
      const productAmount = hasItems
        ? refund.items
            .filter((item) => item.kind === 'product')
            .reduce((sum, item) => sum + moneyToNumber(item.amount), 0)
        : moneyToNumber(refund.customerAmount)
      const shippingRefundAmount = refund.items
        .filter((item) => item.kind === 'shipping')
        .reduce((sum, item) => sum + moneyToNumber(item.amount), 0)

      return {
        customerAmount: totals.customerAmount + moneyToNumber(refund.customerAmount),
        productAmount: totals.productAmount + productAmount,
        shippingAmount: totals.shippingAmount + shippingRefundAmount,
        sellerAdjustmentAmount:
          totals.sellerAdjustmentAmount + moneyToNumber(refund.sellerAdjustmentAmount),
        commissionAdjustmentAmount:
          totals.commissionAdjustmentAmount + moneyToNumber(refund.commissionAdjustmentAmount),
        couponAdjustmentAmount:
          totals.couponAdjustmentAmount + moneyToNumber(refund.couponAdjustmentAmount),
        platformFundedAmount:
          totals.platformFundedAmount + moneyToNumber(refund.platformFundedAmount),
      }
    },
    {
      customerAmount: 0,
      productAmount: 0,
      shippingAmount: 0,
      sellerAdjustmentAmount: 0,
      commissionAdjustmentAmount: 0,
      couponAdjustmentAmount: 0,
      platformFundedAmount: 0,
    },
  )

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

      <div className="grid gap-5 lg:grid-cols-[1.35fr,1fr]">
        <section
          data-testid="admin-order-finance"
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-4 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ürünler ve Finans
          </h2>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Orijinal adet', value: originalQuantity },
              { label: 'Güncel adet', value: currentQuantity },
              { label: 'İptal edilen', value: cancelledQuantity },
              { label: 'Kargolanan', value: shippedQuantity },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border px-3 py-3"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
              >
                <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {label}
                </p>
                <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {value} adet
                </p>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {order.lines.map((line) => {
              const lineCurrentQuantity = Math.max(0, line.quantity - line.cancelledQuantity)
              return (
                <div key={line.id} className="text-sm">
                  <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:gap-4">
                    <div>
                      <p style={{ color: 'var(--color-muted-fg)' }}>{line.productName}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        Orijinal: {line.quantity} · Güncel: {lineCurrentQuantity} · İptal: {line.cancelledQuantity} · Kargolanan: {line.shippedQuantity}
                      </p>
                    </div>
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
              )
            })}
          </div>

          <Separator className="my-3" />

          <div className="space-y-1 text-sm">
            {[
              { label: 'Urunler', value: formatMoney(grossAmount) },
              {
                label: 'İptal edilen brüt ürün',
                value: formatMoney(cancelledGrossProductAmount),
              },
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

          <div
              data-testid="admin-refund-summary"
              className="mt-5 border-t pt-4"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <h3 className="mb-3 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                İade finansı
              </h3>
              <div className="space-y-1 text-sm">
                {[
                  { label: 'Müşteriye ürün iadesi', value: formatMoney(refundTotals.productAmount) },
                  { label: 'Müşteriye kargo iadesi', value: formatMoney(refundTotals.shippingAmount) },
                  { label: 'Müşteriye ürün + kargo iadesi', value: formatMoney(refundTotals.customerAmount) },
                  { label: 'Satıcı payı', value: formatMoney(refundTotals.sellerAdjustmentAmount) },
                  { label: 'Komisyon düzeltmesi', value: formatMoney(refundTotals.commissionAdjustmentAmount) },
                  { label: 'Satıcı kuponu düzeltmesi', value: formatMoney(refundTotals.couponAdjustmentAmount) },
                  { label: 'Platform payı', value: formatMoney(refundTotals.platformFundedAmount) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span style={{ color: 'var(--color-muted-fg)' }}>{label}</span>
                    <span className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  Refund transaction kayıtları
                </h3>
                {order.refundTransactions.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    Bu sipariş için refund transaction kaydı yok.
                  </p>
                ) : (
                  order.refundTransactions.map((refund) => (
                  <div
                    key={refund.id}
                    data-testid={`refund-transaction-${refund.id}`}
                    className="rounded-lg border p-3"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                          Refund transaction · {REFUND_SOURCE_LABELS[refund.sourceType] ?? refund.sourceType}
                        </p>
                        <p className="break-all text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          ID: {refund.id} · {new Date(refund.createdAt).toLocaleString('tr-TR')}
                        </p>
                      </div>
                      <span
                        className="inline-flex w-fit shrink-0 rounded-full border px-2 py-1 text-xs font-medium"
                        style={refundStatusStyle(refund.status)}
                      >
                        {refundStatusLabel(refund.status)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-2" style={{ borderColor: 'var(--color-border)' }}>
                      <div>
                        <p style={{ color: 'var(--color-muted-fg)' }}>Müşteri iadesi</p>
                        <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                          {formatMoney(moneyToNumber(refund.customerAmount))}
                        </p>
                      </div>
                      <div>
                        <p style={{ color: 'var(--color-muted-fg)' }}>Sağlayıcı referansı</p>
                        <p className="break-all font-medium" style={{ color: 'var(--color-primary)' }}>
                          {refund.providerReference ?? '—'}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p style={{ color: 'var(--color-muted-fg)' }}>Hata</p>
                        <p style={{ color: refund.failureReason ? 'var(--color-destructive)' : 'var(--color-primary)' }}>
                          {refund.failureReason ?? '—'}
                        </p>
                      </div>
                      {refund.completedAt ? (
                        <div className="sm:col-span-2">
                          <p style={{ color: 'var(--color-muted-fg)' }}>İade tamamlanma tarihi</p>
                          <p>{new Date(refund.completedAt).toLocaleString('tr-TR')}</p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--color-muted-fg)' }}>
                        İade kalemleri
                      </p>
                      {refund.items.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          Kalem kaydı yok.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {refund.items.map((item) => {
                            const providerReference =
                              item.providerReference ??
                              item.paymentProviderItem?.providerTransactionId ??
                              item.paymentProviderItem?.providerItemId ??
                              '—'
                            return (
                              <div
                                key={item.id}
                                className="rounded-md border p-2"
                                style={{ borderColor: 'var(--color-border)' }}
                              >
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div>
                                    <p className="text-xs font-medium" style={{ color: 'var(--color-primary)' }}>
                                      {REFUND_ITEM_KIND_LABELS[item.kind] ?? item.kind}
                                      {item.orderLine?.productName ? ` · ${item.orderLine.productName}` : ''}
                                    </p>
                                    <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                                      {item.quantity !== null && item.quantity !== undefined
                                        ? `${item.quantity} adet · `
                                        : ''}
                                      {formatMoney(moneyToNumber(item.amount))}
                                    </p>
                                  </div>
                                  <span
                                    className="inline-flex w-fit shrink-0 rounded-full border px-2 py-1 text-xs font-medium"
                                    style={refundStatusStyle(item.status)}
                                  >
                                    {refundStatusLabel(item.status)}
                                  </span>
                                </div>
                                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                                  <div>
                                    <p style={{ color: 'var(--color-muted-fg)' }}>Sağlayıcı referansı</p>
                                    <p className="break-all" style={{ color: 'var(--color-primary)' }}>
                                      {providerReference}
                                    </p>
                                  </div>
                                  <div>
                                    <p style={{ color: 'var(--color-muted-fg)' }}>Hata</p>
                                    <p style={{ color: item.failureReason ? 'var(--color-destructive)' : 'var(--color-primary)' }}>
                                      {item.failureReason ?? '—'}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {refund.status === 'manual_required' ? (
                      <ManualRefundCompletion
                        refundId={refund.id}
                        orderId={order.id}
                        orderLabel={formatOrderDisplayNumber(order.publicNumber, order.id)}
                        customerName={order.customer.name ?? order.customer.email}
                        currency={refund.payment?.currency ?? order.currency}
                        {...getManualEftRefundCompletion(refund)}
                      />
                    ) : null}
                  </div>
                  ))
                )}
              </div>
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
