import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { Button, PageHeader } from '@hanuja/ui'
import { Download, FileText } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createOrderDocumentService } from '@hanuja/api/services/order-document.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Faturalarım',
  robots: { index: false, follow: false },
}

export default async function CustomerInvoicesPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/giris?redirect=/faturalarim')
  }

  const service = createOrderDocumentService({ prisma: createPrismaForRoute() })
  const invoices = await service.listInvoicesForCustomer(session.user.id)

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        title="Faturalarım"
        description="Siparişleriniz için tasarımcıların yüklediği faturalar."
      />

      <div className="mt-6 space-y-3">
        {invoices.length === 0 ? (
          <section
            className="rounded-xl border p-6"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Henüz yüklenmiş fatura bulunmuyor.
            </p>
          </section>
        ) : (
          invoices.map((invoice) => {
            const viewHref = `/api/orders/${invoice.orderId}/documents/invoices/${invoice.sellerId}`
            const downloadHref = `${viewHref}?download=1`
            const uploadedAt = new Date(invoice.uploadedAt).toLocaleDateString('tr-TR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })

            return (
              <section
                key={invoice.id}
                className="flex flex-col gap-4 rounded-xl border p-5 sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
              >
                <div className="min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
                    <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {invoice.seller.displayName}
                    </p>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    Sipariş #{invoice.orderId.slice(-8).toUpperCase()} · {uploadedAt}
                  </p>
                  <p className="mt-1 truncate text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {invoice.fileName}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/siparis/${invoice.orderId}`}>Sipariş</Link>
                  </Button>
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
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
