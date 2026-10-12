import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminSession } from '@/lib/admin-session'
import { AdminCommunicationReply } from '@/components/admin-communication-reply'
import { ReturnReceiptDate } from '@/components/return-receipt-date'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createReturnService } from '@hanuja/api/services/return.service'

export const dynamic = 'force-dynamic'

export default async function AdminReturnDetail({ params }: { params: Promise<{ id: string }> }) {
  await getAdminSession()
  const { id } = await params
  const request = await createReturnService({ prisma: createPrismaForRoute() }).getRequest(id)
  if (!request) notFound()
  return <div className="max-w-4xl space-y-5">
    <Link href="/iadeler" className="underline">İadelere dön</Link>
    <h1 className="text-xl font-semibold">İade incelemesi</h1>
    <p>Durum: {request.status} · Başvuru: {request.claimType}</p>
    <p>İade teslim tarihi: {request.returnCarrierDeliveredAt?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? 'Henüz doğrulanmadı'}</p>
    <p>Ödeme son tarihi: {request.refundDeadlineAt?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? 'Teslim tarihi bekleniyor'}</p>
    <ReturnReceiptDate id={id} />
    {request.sellerRejectReason ? <section className="rounded border p-4">
      <h2 className="font-semibold">Tasarımcının iç değerlendirmesi</h2>
      <p>{request.sellerRejectReason}</p><p>{request.sellerRejectDescription}</p>
    </section> : null}
    <div className="flex flex-wrap gap-3">{request.evidence.map((asset) => <a key={asset.id} href={'/api/media/private/' + asset.id} target="_blank" rel="noreferrer" className="underline">{asset.originalName ?? 'İade görseli'}</a>)}</div>
    {request.disputeId ? <Link href={'/uyusmazliklar/' + request.disputeId} className="underline">İade kararını değerlendir</Link> : null}
    <ol className="space-y-3">{request.messages.map((message) => <li key={message.id} className="rounded border p-3">
      <p className="text-xs">{message.authorRole} · {message.audience ?? 'Geçmiş kayıt — yalnız yönetim'}</p>
      <p className="whitespace-pre-wrap">{message.body}</p>
      {message.attachments.map((asset) => <a key={asset.id} href={'/api/media/private/' + asset.id} className="mr-3 underline">Ek görsel</a>)}
    </li>)}</ol>
    <AdminCommunicationReply endpoint={'/api/admin/returns/' + id + '/messages'} />
  </div>
}
