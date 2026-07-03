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
  const { seller } = await getSellerFromSession()

  const repo = createReturnRequestRepository(createPrismaForRoute())
  const rr = await repo.findByIdForSeller(id, seller.id)
  if (!rr) notFound()

  const data: SellerReturnData = {
    id: rr.id,
    status: rr.status,
    reason: rr.reason,
    description: rr.description,
    sellerReturnAddress: rr.sellerReturnAddress,
    sellerReturnCargoCarrier: rr.sellerReturnCargoCarrier,
    sellerReturnInstructions: rr.sellerReturnInstructions,
    returnCargoProvider: rr.returnCargoProvider,
    returnTrackingNumber: rr.returnTrackingNumber,
    sellerRejectReason: rr.sellerRejectReason,
    evidence: rr.evidence.map((e) => ({ id: e.id, url: e.url })),
    messages: rr.messages.map((m) => ({
      id: m.id,
      authorRole: m.authorRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      attachments: m.attachments.map((a) => ({ id: a.id, url: a.url })),
    })),
    disputeStatus: rr.escalatedDispute?.status ?? null,
    orderNumber: formatOrderDisplayNumber(rr.order.publicNumber, rr.orderId),
    productNames: rr.order.lines
      .filter((l) => l.sellerId === seller.id)
      .map((l) => l.product?.name ?? 'Ürün'),
  }

  return (
    <div className="space-y-6">
      <SellerReturnDetailClient data={data} />
    </div>
  )
}
