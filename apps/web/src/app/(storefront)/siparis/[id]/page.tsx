import { isWithinWithdrawalWindow } from '@hanuja/api/domain/withdrawal-window'
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
import { getPlatformBankInfo } from '@hanuja/api/lib/platform-info'
import { formatOrderDisplayNumber, formatOrderNumber } from '@hanuja/api/lib/order-number'
import { createPlatformBankAccountService } from '@hanuja/api/services/platform-bank-account.service'
import { createCardPaymentService } from '@hanuja/api/services/card-payment.service'
import { getCustomerOrderStatusLabel } from '@/lib/customer-order-status'
import { SupportSection } from './destek/_components/support-section'
import { CancelOrderButton } from './_components/cancel-order-button'
import ExtensionRequestDecision from './_components/extension-request-decision'
import ReturnRequestButton from './_components/return-request-button'
import { ReturnPanel } from './_components/return-panel'
import { OrderLineQuestion } from './_components/order-line-question'

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
  // Ödenmemiş kart siparişi: yeniden ödeme penceresi veya iyzico kontrolü.
  const cardPaymentState =
    order.status === 'payment_pending'
      ? await createCardPaymentService({ prisma })
          .getOrderPaymentState(session.user.id, order.id)
          .catch(() => null)
      : null

  type OrderLine = {
    id: string
    productName: string
    quantity: number
    cancelledQuantity: number
    shippedQuantity: number
    returnClaimedQuantity: number
    deliveredAt: Date | null
    deliveryConfirmedAt: Date | string | null
    unitPrice: { toNumber(): number } | number
    product: { id: string; name: string; slug: string; images: Array<{ url: string }> } | null
  }

  type Shipment = {
    id: string
    trackingNumber: string | null
    status: string
    createdAt: Date
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

  // Hanuja's sales invoice; the designer's invoice to Hanuja is never shown to the customer.
  type CustomerInvoice = {
    id: string
    invoiceNumber: string | null
    fileName: string
    uploadedAt: Date
  } | null

  type ReturnRequest = {
    id: string
    status: string
    createdAt: Date
  }

  const lines = order.lines as unknown as OrderLine[]
  // Seller-visible (payment confirmed) orders only; the server re-checks order, product and seller together.
  const canAskSeller = Boolean((order as { paymentConfirmedAt?: Date | null }).paymentConfirmedAt)
  const isQuantityLifecycle = order.quantityLifecycleVersion === 2
  const cancellationLines = isQuantityLifecycle
    ? lines
        .map((line) => ({
          id: line.id,
          name: line.product?.name ?? line.productName,
          availableQuantity: line.quantity - line.cancelledQuantity - line.shippedQuantity,
        }))
        .filter((line) => line.availableQuantity > 0)
    : []
  const returnLines = isQuantityLifecycle
    ? lines
        .map((line) => ({
          id: line.id,
          name: line.product?.name ?? line.productName,
          availableQuantity: line.shippedQuantity - line.returnClaimedQuantity,
          deliveredAt: line.deliveredAt,
        }))
        .filter(
          (line) =>
            line.availableQuantity > 0 && Boolean(line.deliveredAt),
        )
        .map(({ deliveredAt: _deliveredAt, ...line }) => line)
    : []
  const shipments = (order.shipments ?? []) as unknown as Shipment[]
  const address = (order.address ?? null) as Address
  const legalSnapshot = (order.legalSnapshot ?? null) as LegalSnapshot
  const customerInvoice = (order.customerInvoice ?? null) as unknown as CustomerInvoice
  const returnRequests = (order.returnRequests ?? []) as unknown as ReturnRequest[]

  const grossAmount = moneyToNumber(order.grossAmount)
  const shippingAmount = moneyToNumber(order.shippingAmount)
  const eftDiscount = moneyToNumber(order.eftDiscountAmount)
  const eftDiscountRatePercent = order.eftDiscountRateSnapshot
    ? Number((moneyToNumber(order.eftDiscountRateSnapshot) * 100).toFixed(2))
    : 0
  // Order.discountAmount = checkout kuponu + admin EFT onayında girilen manuel
  // indirim (Payment.eftDiscountAmount). İkisi ayrı satırda gösterilir.
  const manualDiscount = order.payments.reduce(
    (sum, payment) => sum + moneyToNumber(payment.eftDiscountAmount),
    0,
  )
  const couponDiscount = Math.max(0, moneyToNumber(order.discountAmount) - manualDiscount)
  const totalAmount = moneyToNumber(order.totalAmount)
  const installmentCount = order.installmentCount ?? 0
  const installmentDifference = moneyToNumber(order.installmentDifferenceAmount)

  const CUSTOMER_CANCELLABLE_STATUSES = new Set([
    'bank_transfer_waiting',
    'payment_confirmed',
    'seller_queue_ready',
    'seller_reviewing',
    'seller_accepted',
    'preparing',
    'awaiting_shipment',
  ])
  const paymentConfirmed = Boolean((order as { paymentConfirmedAt?: Date | null }).paymentConfirmedAt)
  // Before payment only an EFT order waiting for its transfer can be cancelled,
  // and only as a whole; a card payment still in 3-D Secure cannot.
  const wholeOrderOnly = isQuantityLifecycle && !paymentConfirmed && isEftPending
  const canCustomerCancel = isQuantityLifecycle
    ? cancellationLines.length > 0 && (paymentConfirmed || isEftPending)
    : CUSTOMER_CANCELLABLE_STATUSES.has(order.status)
  const hasActiveReturn = returnRequests.some((r) => r.status !== 'refund_completed')
  const withinReturnWindow = isWithinWithdrawalWindow(order)
  const canCustomerReturn = isQuantityLifecycle
    ? returnLines.length > 0
    : order.status === 'delivery_confirmed' && withinReturnWindow && !hasActiveReturn
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
          {canCustomerCancel ? (
            <CancelOrderButton
              orderId={order.id}
              {...(isQuantityLifecycle ? { lines: cancellationLines } : {})}
              wholeOrderOnly={wholeOrderOnly}
            />
          ) : null}
        </div>
      </div>

      <p className="mb-4 text-sm">
        Teslim öncesinde cayma, ayıp veya garanti bildiriminiz için <Link className="underline" href={'/siparis/' + order.id + '/destek'}>Hanuja desteğine</Link> başvurabilir veya admin@hanuja.com.tr adresine yazabilirsiniz.
      </p>
      {returnRequests.map((returnRequest) => (
        <ReturnPanel key={returnRequest.id} returnRequestId={returnRequest.id} />
      ))}

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
              Cayma süresi son ürünün fiili tesliminden itibaren 14 gündür. Ayıp ve garanti başvuruları bu süreyle sınırlı değildir.
            </p>
          </div>
          <ReturnRequestButton
            withdrawalAllowed={withinReturnWindow}
            orderId={order.id}
            {...(isQuantityLifecycle ? { lines: returnLines } : {})}
          />
        </section>
      ) : null}

      {returnWindowClosed ? (
        <section
          className="mb-5 rounded-xl border p-4 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
        >
          <p style={{ color: 'var(--color-muted-fg)' }}>
            Son ürünün tesliminden itibaren 14 günlük cayma süresi sona erdi.
            Ayıp ve garanti başvurularınızı ilgili başvuru türünü seçerek veya Hanuja desteği üzerinden iletebilirsiniz.
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
              <div key={line.id} className="flex items-start gap-3">
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
                    {isQuantityLifecycle && line.cancelledQuantity > 0
                      ? ` · ${line.cancelledQuantity} iptal`
                      : ''}
                    {isQuantityLifecycle && line.shippedQuantity > 0
                      ? ` · ${line.shippedQuantity} kargolandı`
                      : ''}
                    {isQuantityLifecycle && line.returnClaimedQuantity > 0
                      ? ` · ${line.returnClaimedQuantity} iade sürecinde`
                      : ''}
                  </p>
                  {canAskSeller && line.product ? (
                    <OrderLineQuestion orderId={order.id} productId={line.product.id} />
                  ) : null}
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
          {couponDiscount > 0 ? (
            <div className="flex justify-between" style={{ color: 'var(--color-success, #16a34a)' }}>
              <span>Kupon indirimi{order.couponCode ? ` (${order.couponCode})` : ''}</span>
              <span>-{formatMoney(couponDiscount)}</span>
            </div>
          ) : null}
          {eftDiscount > 0 ? (
            <div className="flex justify-between" style={{ color: 'var(--color-success, #16a34a)' }}>
              <span>Havale/EFT indirimi{eftDiscountRatePercent > 0 ? ` (%${eftDiscountRatePercent})` : ''}</span>
              <span>-{formatMoney(eftDiscount)}</span>
            </div>
          ) : null}
          {manualDiscount > 0 ? (
            <div className="flex justify-between" style={{ color: 'var(--color-success, #16a34a)' }}>
              <span>Ek indirim</span>
              <span>-{formatMoney(manualDiscount)}</span>
            </div>
          ) : null}
          <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
            <span>Kargo</span>
            <span>{shippingAmount === 0 ? 'Ücretsiz' : formatMoney(shippingAmount)}</span>
          </div>
          {installmentDifference > 0 ? (
            <div className="flex justify-between" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Vade farkı ({installmentCount} taksit)</span>
              <span>{formatMoney(installmentDifference, { withKurus: true })}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
            <span>Toplam</span>
            {/* Taksitli tahsilat neredeyse her zaman kuruşludur; kart ekstresiyle aynı tutar gösterilir. */}
            <span>
              {formatMoney(totalAmount, installmentDifference > 0 ? { withKurus: true } : undefined)}
            </span>
          </div>
          {installmentCount > 1 ? (
            <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              Kredi kartı ile {installmentCount} taksit
            </p>
          ) : null}
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

      {cardPaymentState?.checking ? (
        <section
          className="mt-5 rounded-xl border p-5 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          data-testid="order-card-payment-checking"
        >
          <h2 className="mb-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ödemeniz kontrol ediliyor
          </h2>
          <p style={{ color: 'var(--color-muted-fg)' }}>
            Ödemenizin sonucu ödeme kuruluşundan doğrulanıyor. Sonuç netleşince siparişiniz
            hazırlanmaya başlar veya ödeme iade edilir. Bu sırada yeni ödeme yapmanıza gerek yoktur.
          </p>
        </section>
      ) : cardPaymentState?.payable ? (
        <section
          className="mt-5 rounded-xl border p-5 text-sm"
          style={{ borderColor: 'var(--color-warning, #f59e0b)', backgroundColor: 'var(--color-surface)' }}
          data-testid="order-card-payment-pending"
        >
          <h2 className="mb-1 font-semibold" style={{ color: 'var(--color-primary)' }}>
            Ödeme bekleniyor
          </h2>
          <p className="mb-3" style={{ color: 'var(--color-muted-fg)' }}>
            Kart ödemesi tamamlanmadı.
            {cardPaymentState.expiresAt
              ? ` ${new Date(cardPaymentState.expiresAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })} saatine kadar ödemeyi tamamlayabilirsiniz; sonra sipariş iptal edilir.`
              : ''}
          </p>
          <Button asChild size="sm">
            <Link href={`/odeme?siparis=${order.id}`}>Ödemeyi tamamla</Link>
          </Button>
        </section>
      ) : null}

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

      {customerInvoice ? (
        <section
          className="mt-5 rounded-xl border p-5"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <h2 className="mb-3 flex items-center gap-2 font-semibold" style={{ color: 'var(--color-primary)' }}>
            <FileText className="h-4 w-4" /> Fatura
          </h2>
          <div
            className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                {customerInvoice.invoiceNumber ? `Fatura No: ${customerInvoice.invoiceNumber}` : 'Satış faturası'}
              </p>
              <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                {customerInvoice.fileName} ·{' '}
                {new Date(customerInvoice.uploadedAt).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={`/api/orders/${id}/documents/customer-invoice`}>Görüntüle</a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href={`/api/orders/${id}/documents/customer-invoice?download=1`}>
                  <Download className="h-4 w-4" />
                  İndir
                </a>
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* Destek Bölümü */}
      <SupportSection orderId={order.id} />
    </div>
  )
}
