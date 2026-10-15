import { createSellerReturnInvoiceService } from '@hanuja/api/services/seller-return-invoice.service'
import { canSeeMessage } from '@hanuja/api/domain/communication-audience'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getSellerFromSession } from '@/lib/seller-session'
import { createReturnRequestRepository } from '@hanuja/api/repositories/return-request.repository'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'
import {
  SellerReturnDetailClient,
  type SellerReturnData,
} from './_components/seller-return-detail-client'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'İade Detayı' }

interface Props {
  params: Promise<{ id: string }>
}

export default async function SellerReturnDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession({ allowSuspended: true })

  const repo = createReturnRequestRepository(createPrismaForRoute())
  const rr = await repo.findByIdForSeller(id, seller.id)
  if (!rr) notFound()

  const invoice = await createSellerReturnInvoiceService({
    prisma: createPrismaForRoute(),
  }).getForSeller({ returnRequestId: id, sellerId: seller.id })
  const data: SellerReturnData = {
    id: rr.id,
    status: rr.status,
    reason: 'Hanuja iade incelemesi',
    description: null,
    sellerReturnAddress: rr.sellerReturnAddress,
    sellerReturnCargoCarrier: rr.sellerReturnCargoCarrier,
    sellerReturnInstructions: rr.sellerReturnInstructions,
    returnCargoProvider: rr.returnCargoProvider,
    returnTrackingNumber: rr.returnTrackingNumber,
    sellerRejectReason: rr.sellerRejectReason,
    evidence: rr.evidence
      .filter((asset) => asset.uploadedBy === seller.userId)
      .map((e) => ({ id: e.id })),
    messages: rr.messages
      .filter((message) => canSeeMessage('seller', message))
      .map((m) => ({
        id: m.id,
        authorRole: m.authorRole,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        attachments: m.attachments.map((a) => ({ id: a.id })),
      })),
    disputeStatus: rr.escalatedDispute?.status ?? null,
    orderNumber: formatOrderDisplayNumber(rr.order.publicNumber, rr.orderId),
    productNames: rr.order.lines
      .filter((l) => l.sellerId === seller.id)
      .map((l) => l.product?.name ?? 'Ürün'),
    items: rr.items.map((item) => ({
      id: item.id,
      productName: item.orderLine.productName,
      requestedQuantity: item.requestedQuantity,
      acceptedQuantity: item.acceptedQuantity,
      rejectedQuantity: item.rejectedQuantity,
      rejectionReason: item.rejectionReason,
    })),
  }

  return (
    <div className="space-y-6">
      <SellerReturnDetailClient data={data} />
      <section className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">Hanuja iade faturası</h2>
        {invoice ? (
          <>
            <p>
              {invoice.invoiceNumber} · KDV dahil {invoice.amount.toFixed(2)} TL
            </p>
            <div className="flex gap-3">
              <a
                href={'/api/seller/returns/' + id + '/invoice'}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Faturayı görüntüle
              </a>
              <a href={'/api/seller/returns/' + id + '/invoice?download=1'} className="underline">
                İndir
              </a>
            </div>
          </>
        ) : (
          <p>Henüz iade faturası yüklenmedi.</p>
        )}
      </section>
    </div>
  )
}
