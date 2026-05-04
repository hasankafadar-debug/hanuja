import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Breadcrumb, Button, LegalDocumentDialog, Separator, StatusBadge } from '@hanuja/ui'
import { CreditCard, Download, FileText, MapPin, Package } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

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
    const service = createOrderService({ prisma: createPrismaForRoute() })
    order = await service.getOrderForCustomer(id, session.user.id)
  } catch (err) {
    console.error('[OrderDetailPage] getOrderForCustomer failed:', err)
    throw err
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

  type Payment = {
    id: string
    status: string
    eftDiscountAmount: { toNumber(): number } | number | null
    eftDiscountReason: string | null
  }

  type Address = {
    fullName: string
    phone: string
    addressLine1: string
    addressLine2: string | null
    district: string
    city: string
    postalCode: string
  } | null

  type LegalSnapshot = {
    distanceSalesHtml: string
    preInformationHtml: string
  } | null

  type SellerInvoice = {
    id: string
    sellerId: string
    fileName: string
    mimeType: string
    uploadedAt: Date
    seller: { id: string; displayName: string; slug: string | null }
  }

  const lines = order.lines as unknown as OrderLine[]
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const payments = (order.payments ?? []) as unknown as Payment[]
  const address = (order.address ?? null) as Address
  const legalSnapshot = (order.legalSnapshot ?? null) as LegalSnapshot
  const sellerInvoices = (order.sellerInvoices ?? []) as unknown as SellerInvoice[]

  const subtotal = lines.reduce((sum, line) => {
    const price = typeof line.unitPrice === 'object' ? line.unitPrice.toNumber() : Number(line.unitPrice)
    return sum + price * line.quantity
  }, 0)

  const eftDiscount = payments.reduce((sum, payment) => {
    if (!payment.eftDiscountAmount) return sum
    const value =
      typeof payment.eftDiscountAmount === 'object'
        ? payment.eftDiscountAmount.toNumber()
        : Number(payment.eftDiscountAmount)
    return sum + value
  }, 0)
  const eftDiscountReason = payments.find((payment) => payment.eftDiscountReason)?.eftDiscountReason ?? null

  const latestShipment = shipments[0]
  const addressLines = address
    ? [
        address.fullName,
        address.addressLine1,
        address.addressLine2,
        `${address.district} / ${address.city} ${address.postalCode}`,
        address.phone,
      ].filter(Boolean)
    : []

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
    { label: formatOrderDisplayNumber(order.publicNumber, order.id) },
  ]

  const distanceSalesDownloadHref = `/api/orders/${id}/documents/contracts/distance-sales`
  const preInformationDownloadHref = `/api/orders/${id}/documents/contracts/pre-information`

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Breadcrumb items={breadcrumbItems} className="mb-8" />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold font-mono" style={{ color: 'var(--color-primary)' }}>
            Sipariş {formatOrderDisplayNumber(order.publicNumber, order.id)}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {date}
          </p>
        </div>
        <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
      </div>

      <section
        className="mb-5 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <h2 className="mb-4 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
          <Package className="h-4 w-4" /> Ürünler
        </h2>
        <div className="space-y-4">
          {lines.map((line) => {
            const price = typeof line.unitPrice === 'object' ? line.unitPrice.toNumber() : Number(line.unitPrice)
            const image = line.product?.images?.[0]?.url

            return (
              <div key={line.id} className="flex items-center gap-3">
                <div
                  className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg text-xs"
                  style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
                >
                  {image ? (
                    <Image src={image} alt={line.product?.name ?? ''} fill className="object-cover" />
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
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {line.quantity} adet
                  </p>
                </div>
                <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                  ₺{(price * line.quantity).toLocaleString('tr-TR')}
                </span>
              </div>
            )
          })}
        </div>
        <Separator className="my-4" />
        {eftDiscount > 0 ? (
          <div className="mb-1 flex justify-between text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            <span>
              EFT indirimi
              {eftDiscountReason ? <span className="ml-1 text-xs">({eftDiscountReason})</span> : null}
            </span>
            <span style={{ color: 'var(--color-success, #16a34a)' }}>
              −₺{eftDiscount.toLocaleString('tr-TR')}
            </span>
          </div>
        ) : null}
        <div className="flex justify-between text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
          <span>Toplam</span>
          <span>₺{(subtotal - eftDiscount).toLocaleString('tr-TR')}</span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            <MapPin className="h-4 w-4" /> Teslimat Adresi
          </h2>
          {addressLines.length > 0 ? (
            <div className="space-y-1 text-sm leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              {addressLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted-fg)' }}>
              Adres bilgisi mevcut değil.
            </p>
          )}
        </section>

        <section
          className="rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
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

      {legalSnapshot ? (
        <section
          className="mt-5 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Sözleşmeler
          </h2>
          <p className="mb-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Siparişiniz oluşturulurken kaydedilen sözleşme metinlerine buradan erişebilirsiniz.
          </p>
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
        </section>
      ) : null}

      {sellerInvoices.length > 0 ? (
        <section
          className="mt-5 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            <FileText className="h-4 w-4" /> Satıcı Faturaları
          </h2>
          <div className="space-y-3">
            {sellerInvoices.map((invoice) => {
              const viewHref = `/api/orders/${id}/documents/invoices/${invoice.sellerId}`
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
        </section>
      ) : null}
    </div>
  )
}
