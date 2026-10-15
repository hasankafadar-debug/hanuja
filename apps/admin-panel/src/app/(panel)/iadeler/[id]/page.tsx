import { createSellerReturnInvoiceService } from '@hanuja/api/services/seller-return-invoice.service'
import { SellerReturnInvoiceCard } from '@/components/seller-return-invoice-card'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminSession } from '@/lib/admin-session'
import { AdminCommunicationReply } from '@/components/admin-communication-reply'
import { ReturnReceiptDate } from '@/components/return-receipt-date'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createReturnService } from '@hanuja/api/services/return.service'
import { formatOrderDisplayNumber } from '@hanuja/api/lib/order-number'

export const dynamic = 'force-dynamic'

export default async function AdminReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  const { id } = await params
  const request = await createReturnService({
    prisma: createPrismaForRoute(),
  }).getRequest(id)
  if (!request) notFound()
  const sellerIds = request.sellerId
    ? [request.sellerId]
    : [...new Set(request.order.lines.map((line) => line.sellerId))]
  const invoiceService = createSellerReturnInvoiceService({
    prisma: createPrismaForRoute(),
  })
  const sellers = await createPrismaForRoute().seller.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, displayName: true },
  })
  const invoices = await Promise.all(
    sellerIds.map(async (sellerId) => ({
      sellerId,
      sellerName: sellers.find((seller) => seller.id === sellerId)?.displayName ?? 'Tasarımcı',
      ...(await invoiceService.getForAdmin({
        returnRequestId: id,
        sellerId,
        actorId: session.user.id,
      })),
    })),
  )
  return (
    <div className="max-w-4xl space-y-5">
      <Link href="/iadeler" className="underline">
        İadelere dön
      </Link>
      <h1 className="text-xl font-semibold">İade incelemesi</h1>
      <div className="flex flex-wrap gap-3">
        <Link href={'/siparisler/' + request.orderId} className="underline">
          {formatOrderDisplayNumber(request.order.publicNumber, request.orderId)} · Sipariş ve ödeme
          teyidi
        </Link>
        <Link href="/iadeler?tab=manual_refunds" className="underline">
          Bekleyen EFT iadeleri
        </Link>
      </div>
      <p>
        Durum: {request.status} · Başvuru: {request.claimType}
      </p>
      <p>
        İade teslim tarihi:{' '}
        {request.returnCarrierDeliveredAt?.toLocaleString('tr-TR', {
          timeZone: 'Europe/Istanbul',
        }) ?? 'Henüz doğrulanmadı'}
      </p>
      <p>
        Ödeme son tarihi:{' '}
        {request.refundDeadlineAt?.toLocaleString('tr-TR', {
          timeZone: 'Europe/Istanbul',
        }) ?? 'Teslim tarihi bekleniyor'}
      </p>
      <ReturnReceiptDate id={id} />
      <section className="space-y-2 rounded border p-4">
        <h2 className="font-semibold">Müşterinin başvurusu</h2>
        <p className="whitespace-pre-wrap">{request.reason}</p>
        {request.description ? <p className="whitespace-pre-wrap">{request.description}</p> : null}
        {request.items.map((item) => (
          <p key={item.id}>
            {item.orderLine.productName} · Talep {item.requestedQuantity} · Tasarımcı kabul{' '}
            {item.acceptedQuantity} / red {item.rejectedQuantity}
            {item.rejectionReason ? ' · ' + item.rejectionReason : ''}
          </p>
        ))}
      </section>
      {invoices.map((row) => (
        <SellerReturnInvoiceCard
          key={row.sellerId}
          returnId={id}
          sellerId={row.sellerId}
          sellerName={row.sellerName}
          invoice={
            row.invoice
              ? {
                  revision: row.invoice.revision,
                  invoiceNumber: row.invoice.invoiceNumber,
                  invoiceDate: row.invoice.invoiceDate.toISOString(),
                  fileName: row.invoice.fileName,
                }
              : null
          }
          amount={row.amount}
          ready={row.ready}
          message={row.message}
          vatGroups={row.vatGroups}
        />
      ))}
      {request.sellerRejectReason ? (
        <section className="rounded border p-4">
          <h2 className="font-semibold">Tasarımcının iç değerlendirmesi</h2>
          <p>{request.sellerRejectReason}</p>
          <p>{request.sellerRejectDescription}</p>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {request.evidence.map((asset) => (
          <a
            key={asset.id}
            href={'/api/media/private/' + asset.id}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {asset.originalName ?? 'İade görseli'}
          </a>
        ))}
      </div>
      {request.disputeId ? (
        <Link href={'/uyusmazliklar/' + request.disputeId} className="underline">
          İade kararını değerlendir
        </Link>
      ) : null}
      <ol className="space-y-3">
        {request.messages.map((message) => (
          <li key={message.id} className="rounded border p-3">
            <p className="text-xs">
              {message.authorRole} · {message.audience ?? 'Geçmiş kayıt — yalnız yönetim'}
            </p>
            <p className="whitespace-pre-wrap">{message.body}</p>
            {message.attachments.map((asset) => (
              <a key={asset.id} href={'/api/media/private/' + asset.id} className="mr-3 underline">
                Ek görsel
              </a>
            ))}
          </li>
        ))}
      </ol>
      <AdminCommunicationReply endpoint={'/api/admin/returns/' + id + '/messages'} />
    </div>
  )
}
