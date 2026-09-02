import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LegalDocumentDialog, PageHeader, Separator, StatusBadge } from '@hanuja/ui'
import { ArrowLeft, FileText, MapPin, UserRound } from 'lucide-react'
import { maskCustomerName, formatMoney } from '@hanuja/security'
import { getSellerFromSession } from '@/lib/seller-session'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import InvoiceAliasCard from './_components/invoice-alias-card'
import InvoiceUploadCard from './_components/invoice-upload-card'
import OrderTimeline from './_components/order-timeline'
import OrderWorkflowCard from './_components/order-workflow-card'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
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

export default async function SellerOrderDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession({ allowSuspended: true })

  const prisma = createPrismaForRoute()
  const service = createOrderService({ prisma })
  const order = await service.getOrderForSeller(id, seller.id)

  if (!order) notFound()

  const invoiceAlias = await createOrderDocumentService({ prisma })
    .ensureInvoiceAliasForSeller(id, seller.id)
    .catch(() => null)

  const fulfillment = order.sellerFulfillments?.[0]
  const fulfillmentStatusMap: Record<string, string> = {
    queue_ready: 'seller_queue_ready',
    reviewing: 'seller_reviewing',
    accepted: 'seller_accepted',
  }
  const operationalStatus = order.quantityLifecycleVersion === 2 && fulfillment
    ? (fulfillmentStatusMap[fulfillment.status] ?? fulfillment.status)
    : order.status
  const ACTIVE_FULFILLMENT_STATUSES = new Set([
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'preparing',
    'awaiting_shipment',
  ])
  const canRequestExtension = ACTIVE_FULFILLMENT_STATUSES.has(operationalStatus)
  const openExtensionRequest = canRequestExtension
    ? await prisma.fulfillmentExtensionRequest.findFirst({
        where: {
          orderId: id,
          sellerId: seller.id,
          status: {
            in: ['pending_admin_review', 'awaiting_customer_decision', 'awaiting_seller_followup'],
          },
        },
        select: { id: true },
      })
    : null

  type OrderLine = {
    id: string
    quantity: number
    cancelledQuantity: number
    shippedQuantity: number
    unitPrice: { toNumber(): number } | number
    commissionAmount?: { toNumber(): number } | number
    product: { id: string; name: string; slug: string } | null
  }

  type Shipment = {
    id: string
    cargoProvider: string | null
    trackingNumber: string | null
    status: string
  }

  type LegalSnapshot = {
    distanceSalesHtml: string
    preInformationHtml: string
  } | null

  type SellerInvoice = {
    id: string
    fileName: string
    uploadedAt: Date
  }

  type Address = {
    fullName: string
    phone?: string | null
    addressLine1: string
    addressLine2?: string | null
    district: string
    city: string
    postalCode: string
  } | null

  type Customer = {
    name?: string | null
    email?: string | null
  } | null

  type Penalty = {
    id: string
    penaltyAmount: { toNumber(): number } | number
    reason: string
    status: string
  }

  type StatusHistory = {
    id: string
    toStatus: string
    note?: string | null
    reason?: string | null
    createdAt: Date
  }

  const lines = order.lines as unknown as OrderLine[]
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const legalSnapshot = (order.legalSnapshot ?? null) as LegalSnapshot
  const sellerInvoice = ((order.sellerInvoices ?? []) as unknown as SellerInvoice[])[0] ?? null
  const latestShipment = shipments[0] ?? null
  const address = (order.address ?? null) as Address
  const customer = (order.customer ?? null) as Customer
  const penalties = (order.penalties ?? []) as unknown as Penalty[]
  const statusHistory = (order.statusHistory ?? []) as unknown as StatusHistory[]

  const toNumber = (value: unknown) => {
    if (value === null || value === undefined) return 0
    if (typeof value === 'object' && 'toNumber' in (value as object)) {
      return (value as { toNumber(): number }).toNumber()
    }
    return Number(value)
  }

  const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const distanceSalesDownloadHref = `/api/seller/orders/${id}/contracts/distance-sales`
  const preInformationDownloadHref = `/api/seller/orders/${id}/contracts/pre-information`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            href="/siparisler"
            className="mb-3 inline-flex items-center gap-1.5 text-sm"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            <ArrowLeft className="h-4 w-4" /> Siparişlere Dön
          </Link>
          <PageHeader
            title={`Sipariş ${formatOrderDisplayNumber(order.publicNumber, order.id)}`}
            description={date}
          />
        </div>
        <StatusBadge status={operationalStatus as Parameters<typeof StatusBadge>[0]['status']} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr,1fr]">
        <div className="space-y-6">
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
              Ürünler
            </h2>
            <div className="space-y-4">
              {lines.map((line) => {
                const total = toNumber(line.unitPrice) * line.quantity
                return (
                  <div key={line.id} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {line.product?.name ?? 'Ürün'}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {line.quantity} adet
                        {line.cancelledQuantity > 0 ? ` · ${line.cancelledQuantity} iptal` : ''}
                        {line.shippedQuantity > 0 ? ` · ${line.shippedQuantity} kargolandı` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatMoney(total)}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>

          <OrderWorkflowCard
            orderId={id}
            status={operationalStatus}
            trackingNumber={latestShipment?.trackingNumber ?? null}
            cargoProvider={latestShipment?.cargoProvider ?? null}
            canRequestExtension={canRequestExtension}
            pendingRequestId={openExtensionRequest?.id ?? null}
          />

          <OrderTimeline items={statusHistory} />

          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Sipariş Belgeleri
              </h2>
            </div>
            {legalSnapshot ? (
              <div className="flex flex-wrap gap-2">
                <LegalDocumentDialog
                  title="Mesafeli Satış Sözleşmesi"
                  html={legalSnapshot.distanceSalesHtml}
                  triggerLabel="Mesafeli Satış Sözleşmesi"
                  triggerVariant="outline"
                  downloadHref={distanceSalesDownloadHref}
                />
                <LegalDocumentDialog
                  title="Ön Bilgilendirme Formu"
                  html={legalSnapshot.preInformationHtml}
                  triggerLabel="Ön Bilgilendirme Formu"
                  triggerVariant="outline"
                  downloadHref={preInformationDownloadHref}
                />
              </div>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                Bu sipariş için sözleşme kaydı bulunamadı.
              </p>
            )}
          </section>

          <InvoiceUploadCard
            orderId={id}
            currentInvoice={
              sellerInvoice
                ? {
                    fileName: sellerInvoice.fileName,
                    uploadedAt: new Date(sellerInvoice.uploadedAt).toLocaleDateString('tr-TR', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                  }
                : null
            }
          />

          <InvoiceAliasCard aliasEmail={invoiceAlias?.aliasEmail ?? null} />

        </div>

        <div className="space-y-6">
          <section
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <UserRound className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Müşteri ve Teslimat
              </h2>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                  {address?.fullName ?? maskCustomerName(customer?.name)}
                </p>
                {address?.phone ? (
                  <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    {address.phone}
                  </p>
                ) : null}
              </div>
              <Separator />
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} />
                <p style={{ color: 'var(--color-muted-fg)' }}>
                  {address
                    ? [address.addressLine1, address.addressLine2, `${address.district} / ${address.city}`, address.postalCode]
                        .filter(Boolean)
                        .join(', ')
                    : 'Teslimat adresi mevcut değil.'}
                </p>
              </div>
            </div>
          </section>

          {penalties.length > 0 ? (
            <section
              className="rounded-xl border p-5"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            >
              <h2 className="mb-4 text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
                Ceza Kayıtları
              </h2>
              <div className="space-y-3">
                {penalties.map((penalty) => (
                  <div
                    key={penalty.id}
                    className="rounded-lg border p-3"
                    style={{ borderColor: 'var(--color-border)' }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {penalty.reason}
                      </p>
                      <StatusBadge status={penalty.status} />
                    </div>
                    <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatMoney(toNumber(penalty.penaltyAmount))}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
