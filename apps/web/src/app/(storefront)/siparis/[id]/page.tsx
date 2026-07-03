import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Breadcrumb, Button, LegalDocumentDialog, Separator, StatusBadge } from '@hanuja/ui'
import { formatMoney } from '@hanuja/security'
import { CreditCard, Download, FileText, MapPin, Package } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { RETURN_WINDOW_DAYS } from '@hanuja/api/domain/penalty-calculator'
import { getPlatformBankInfo } from '@hanuja/api/lib/platform-info'
import { formatOrderDisplayNumber, formatOrderNumber } from '@hanuja/api/lib/order-number'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'
import { SupportSection } from './destek/_components/support-section'
import { CancelOrderButton } from './_components/cancel-order-button'
import ExtensionRequestDecision from './_components/extension-request-decision'
import ReturnRequestButton from './_components/return-request-button'
import { ReturnPanel } from './_components/return-panel'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

function moneyToNumber(value: { toNumber(): number } | number | null | undefined) {
  if (!value) return 0
  return typeof value === 'object' ? value.toNumber() : Number(value)
}

function formatIban(value: string) {
  return value.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

function isSchemaOutOfSyncError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: string }).code === 'P2021' || (error as { code?: string }).code === 'P2022')
  )
}

function getCustomerOrderStatusLabel(status: string) {
  return status === 'delivery_confirmed' ? 'Tamamlanan Sipariş' : undefined
}

function isWithinReturnWindow(deliveryConfirmedAt: Date | string | null | undefined) {
  if (!deliveryConfirmedAt) return false
  const deadline = new Date(deliveryConfirmedAt)
  deadline.setDate(deadline.getDate() + RETURN_WINDOW_DAYS)
  return new Date() <= deadline
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const prisma = createPrismaForRoute()
  const order = await prisma.order.findUnique({
    where: { id },
    select: { publicNumber: true },
  })
  return {
    title: `Sipariş ${formatOrderDisplayNumber(order?.publicNumber, id)}`,
    robots: { index: false, follow: false },
  }
}

export default async function OrderDetailPage({ params }: Props) {
  const { id } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect(`/giris?redirect=/siparis/${id}`)
  }

  const prisma = createPrismaForRoute()
  let order
  try {
    const service = createOrderService({ prisma })
    order = await service.getOrderForCustomer(id, session.user.id)
  } catch (err) {
    console.error('[OrderDetailPage] getOrderForCustomer failed:', err)
    throw err
  }

  if (!order) notFound()

  let pendingCustomerExtensionRequest: {
    id: string
    requestedDays: number
    sellerReason: string | null
    customerQuestionFromAdmin: string | null
  } | null = null

  try {
    pendingCustomerExtensionRequest = await prisma.fulfillmentExtensionRequest.findFirst({
      where: {
        orderId: id,
        customerId: session.user.id,
        status: 'awaiting_customer_decision',
      },
      select: {
        id: true,
        requestedDays: true,
        sellerReason: true,
        customerQuestionFromAdmin: true,
      },
    })
  } catch (err) {
    if (isSchemaOutOfSyncError(err)) {
      console.warn('[OrderDetailPage] fulfillmentExtensionRequest query skipped due to schema mismatch:', err)
    } else {
      throw err
    }
  }

  // bank_transfer_waiting yalnızca EFT siparişlerinde atanır
  const isEftPending = order.status === 'bank_transfer_waiting'
  const bankAccounts = isEftPending
    ? await createPlatformBankAccountService({ prisma }).listActive().catch(() => [])
    : []
  const fallbackBankAccount = isEftPending && bankAccounts.length === 0
    ? getPlatformBankInfo(formatOrderNumber(order.publicNumber, order.id))
    : null

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

  type ReturnRequest = {
    id: string
    status: string
    createdAt: Date
  }

  const lines = order.lines as unknown as OrderLine[]
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const payments = (order.payments ?? []) as unknown as Payment[]
  const address = (order.address ?? null) as Address
  const legalSnapshot = (order.legalSnapshot ?? null) as LegalSnapshot
  const sellerInvoices = (order.sellerInvoices ?? []) as unknown as SellerInvoice[]
  const returnRequests = (order.returnRequests ?? []) as unknown as ReturnRequest[]

  const grossAmount = moneyToNumber(order.grossAmount)
  const shippingAmount = moneyToNumber(order.shippingAmount)
  const eftDiscount = moneyToNumber(order.eftDiscountAmount)
  const totalAmount = moneyToNumber(order.totalAmount)

  const CUSTOMER_CANCELLABLE_STATUSES = new Set([
    'bank_transfer_waiting',
    'payment_confirmed',
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'preparing',
    'awaiting_shipment',
  ])
  const canCustomerCancel = CUSTOMER_CANCELLABLE_STATUSES.has(order.status)
  const latestReturn = returnRequests[0]
  const hasActiveReturn = returnRequests.some((r) => r.status !== 'refund_completed')
  const withinReturnWindow = isWithinReturnWindow(order.deliveryConfirmedAt)
  const canCustomerReturn =
    order.status === 'delivery_confirmed' && withinReturnWindow && !hasActiveReturn
  // Pencere kapandıktan sonra iade yolu tamamen kapalıdır (politika kararı)
  const returnWindowClosed =
    order.status === 'delivery_confirmed' && !withinReturnWindow && returnRequests.length === 0
  const statusLabel = getCustomerOrderStatusLabel(order.status)

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
        <div className="flex items-center gap-3">
          <StatusBadge
            status={order.status as Parameters<typeof StatusBadge>[0]['status']}
            {...(statusLabel ? { label: statusLabel } : {})}
          />
          {canCustomerCancel ? <CancelOrderButton orderId={order.id} /> : null}
        </div>
      </div>

      {latestReturn ? <ReturnPanel returnRequestId={latestReturn.id} /> : null}

      {canCustomerReturn ? (
        <section
          className="mb-5 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <div className="mb-3">
            <h2 className="font-semibold" style={{ color: 'var(--color-primary)' }}>
              İade
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Teslim onayından itibaren 14 gün içinde iade talebi oluşturabilirsiniz.
            </p>
          </div>
          <ReturnRequestButton orderId={order.id} />
        </section>
      ) : null}

      {returnWindowClosed ? (
        <section
          className="mb-5 rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p style={{ color: 'var(--color-muted-fg)' }}>
            İade süresi doldu. Teslim onayından sonraki 14 günlük iade hakkı sona erdiği için
            bu sipariş için iade talebi oluşturulamaz.
          </p>
        </section>
      ) : null}

      {pendingCustomerExtensionRequest ? (
        <div className="mb-5">
          <ExtensionRequestDecision
            orderId={order.id}
            requestId={pendingCustomerExtensionRequest.id}
            requestedDays={pendingCustomerExtensionRequest.requestedDays}
            sellerReason={pendingCustomerExtensionRequest.sellerReason ?? ''}
            questionFromAdmin={pendingCustomerExtensionRequest.customerQuestionFromAdmin ?? null}
          />
        </div>
      ) : null}

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
                  {formatMoney(price * line.quantity)}
                </span>
              </div>
            )
          })}
        </div>
        <Separator className="my-4" />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
            <span>Ürünler</span>
            <span>{formatMoney(grossAmount)}</span>
          </div>
          {eftDiscount > 0 ? (
            <div className="flex justify-between" style={{ color: 'var(--color-success, #16a34a)' }}>
              <span>EFT indirimi</span>
              <span>-{formatMoney(eftDiscount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
            <span>Kargo</span>
            <span>{shippingAmount === 0 ? 'Ücretsiz' : formatMoney(shippingAmount)}</span>
          </div>
          <div className="flex justify-between text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            <span>Toplam</span>
            <span>{formatMoney(totalAmount)}</span>
          </div>
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

      {isEftPending ? (
        <section
          className="mt-5 rounded-xl border p-5"
          style={{
            borderColor: 'var(--color-warning, #f59e0b)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <h2 className="mb-1 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            <CreditCard className="h-4 w-4" /> Havale / EFT Ödeme Bilgileri
          </h2>
          <p className="mb-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Aşağıdaki hesaplardan birine havale/EFT yapabilirsiniz. Siparişinizin onaylanabilmesi için lütfen açıklama kısmına sipariş numaranızı yazınız.
          </p>
          <div
            className="mb-4 rounded-lg border p-3 text-sm"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
          >
            <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
              Havale aciklamasi / referans
            </p>
            <p className="mt-1 font-mono text-base" style={{ color: 'var(--color-primary)' }}>
              {formatOrderNumber(order.publicNumber, order.id)}
            </p>
          </div>
          <div className="space-y-3">
            {bankAccounts.map((bank) => (
              <div
                key={bank.id}
                className="rounded-lg border p-4"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {bank.bankName}
                  {bank.branchName ? ` — ${bank.branchName}` : ''}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {bank.accountHolder}
                  {bank.accountHolderNote ? (
                    <span className="ml-1 text-xs italic">({bank.accountHolderNote})</span>
                  ) : null}
                </p>
                <p className="mt-1 font-mono text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {formatIban(bank.iban)}
                </p>
              </div>
            ))}
            {fallbackBankAccount?.missing ? (
              <div className="rounded-lg border p-4 text-sm" style={{ borderColor: 'var(--color-border)' }}>
                Banka bilgileri su an listelenemedi. Size kisa sure icinde e-posta ile iletilecek.
              </div>
            ) : fallbackBankAccount ? (
              <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
                <p className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {fallbackBankAccount.bankName}
                  {fallbackBankAccount.branchName ? ` - ${fallbackBankAccount.branchName}` : ''}
                </p>
                <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  {fallbackBankAccount.accountHolder}
                  {fallbackBankAccount.accountHolderNote ? (
                    <span className="ml-1 text-xs italic">({fallbackBankAccount.accountHolderNote})</span>
                  ) : null}
                </p>
                <p className="mt-1 font-mono text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {formatIban(fallbackBankAccount.iban)}
                </p>
              </div>
            ) : null}
          </div>
          <div
            className="mt-4 rounded-lg p-3 text-sm font-medium"
            style={{
              backgroundColor: 'var(--color-warning-bg, #fffbeb)',
              color: 'var(--color-warning-fg, #92400e)',
              border: '1px solid var(--color-warning, #f59e0b)',
            }}
          >
            ⚠️ Havale/EFT ile ödeme yaptığınızda açıklama kısmına{' '}
            <span className="font-bold">sipariş numaranızı</span> yazmanız zorunludur. Teşekkürler.
          </div>
        </section>
      ) : null}

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

      {/* Destek Bölümü */}
      <SupportSection orderId={order.id} />
    </div>
  )
}

