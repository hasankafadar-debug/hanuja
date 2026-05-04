import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Button, EmptyState, LegalDocumentDialog, StatusBadge } from '@hanuja/ui'
import { Download, FileText, Package } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createOrderService } from '@hanuja/api/services/order.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Siparişlerim',
  description: 'Tüm siparişlerinizi takip edin.',
  robots: { index: false, follow: false },
}

async function getOrders(customerId: string) {
  try {
    const service = createOrderService({ prisma: createPrismaForRoute() })
    return await service.listForCustomer(customerId, 0, 20)
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
      <div data-testid="empty-state" className="mx-auto max-w-2xl px-4 py-20 sm:px-6 lg:px-8">
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
    publicNumber?: number | null
    createdAt: Date
    status: string
    totalAmount: { toNumber(): number } | number
    lines: Array<{ product: { name: string } | null }>
    legalSnapshot: {
      distanceSalesHtml: string
      preInformationHtml: string
    } | null
    sellerInvoices: Array<{
      id: string
      sellerId: string
      fileName: string
      seller: { id: string; displayName: string; slug: string | null }
    }>
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
            .map((line) => line.product?.name ?? 'Ürün')
            .join(', ')
          const date = new Date(order.createdAt).toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })

          return (
            <div
              key={order.id}
              data-testid="order-row"
              className="rounded-xl border p-5 transition-shadow hover:shadow-md"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold font-mono text-sm" style={{ color: 'var(--color-primary)' }}>
                    {formatOrderDisplayNumber(order.publicNumber, order.id)}
                  </p>
                  <p className="mt-0.5 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    {date}
                  </p>
                  <p className="mt-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    {itemNames}
                    {order.lines.length > 2 ? ` ve ${order.lines.length - 2} ürün daha` : ''}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-2">
                  <StatusBadge status={order.status as Parameters<typeof StatusBadge>[0]['status']} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                    ₺{total.toLocaleString('tr-TR')}
                  </span>
                </div>
              </div>

              <div
                className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <Button asChild variant="outline" size="sm">
                  <Link href={`/siparis/${order.id}`}>Detay</Link>
                </Button>

                {order.legalSnapshot ? (
                  <>
                    <LegalDocumentDialog
                      title="Mesafeli Satış Sözleşmesi"
                      html={order.legalSnapshot.distanceSalesHtml}
                      triggerLabel="Mesafeli Satış"
                      triggerVariant="outline"
                      downloadHref={`/api/orders/${order.id}/documents/contracts/distance-sales`}
                    />
                    <LegalDocumentDialog
                      title="Ön Bilgilendirme Formu"
                      html={order.legalSnapshot.preInformationHtml}
                      triggerLabel="Ön Bilgilendirme"
                      triggerVariant="outline"
                      downloadHref={`/api/orders/${order.id}/documents/contracts/pre-information`}
                    />
                  </>
                ) : null}

                {order.sellerInvoices.map((invoice) => {
                  const viewHref = `/api/orders/${order.id}/documents/invoices/${invoice.sellerId}`
                  const downloadHref = `${viewHref}?download=1`

                  return (
                    <div key={invoice.id} className="flex items-center gap-2">
                      <Button asChild variant="outline" size="sm">
                        <a href={viewHref}>{invoice.seller.displayName} faturası</a>
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <a href={downloadHref} aria-label={`${invoice.seller.displayName} faturasını indir`}>
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  )
                })}
              </div>

              {order.sellerInvoices.length > 0 ? (
                <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  <FileText className="h-3.5 w-3.5" />
                  <span>{order.sellerInvoices.length} satıcı faturası hazır</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
