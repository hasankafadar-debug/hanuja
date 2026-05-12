import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { Button } from '@hanuja/ui'
import { auth } from '@/lib/auth'
import { createCustomerSupportTicketService } from '@hanuja/api/services/customer-support-ticket.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { TicketThreadClient } from './_components/ticket-thread-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Destek Talebi',
  robots: { index: false, follow: false },
}

const CATEGORY_LABELS: Record<string, string> = {
  shipping_delay: 'Kargo gecikmesi',
  damaged_product: 'Ürün hasarlı / hatalı',
  wrong_product: 'Yanlış ürün geldi',
  invoice_issue: 'Fatura sorunu',
  payment_issue: 'Ödeme sorunu',
  return_or_exchange: 'İade & Değişim',
  other: 'Diğer',
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'waiting_for_admin') {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800">
        İnceleniyor
      </span>
    )
  }
  if (status === 'waiting_for_customer') {
    return (
      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
        Yanıtınız bekleniyor
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
      Çözümlendi
    </span>
  )
}

interface Props {
  params: Promise<{ id: string; ticketId: string }>
}

export default async function TicketDetailPage({ params }: Props) {
  const { id: orderId, ticketId } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect(`/giris?redirect=/siparis/${orderId}/destek/${ticketId}`)
  }

  const prisma = createPrismaForRoute()
  const svc = createCustomerSupportTicketService({ prisma })

  let ticket
  try {
    ticket = await svc.getByIdForCustomer(ticketId, session.user.id)
  } catch {
    notFound()
  }

  // Ensure ticket belongs to this order
  if (ticket.orderId !== orderId) notFound()

  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: session.user.id },
    select: { id: true, publicNumber: true },
  })
  if (!order) notFound()

  const orderLabel =
    order.publicNumber !== null
      ? String(order.publicNumber).padStart(6, '0')
      : orderId.slice(-8).toUpperCase()

  const categoryLabel = CATEGORY_LABELS[ticket.category] ?? ticket.category

  const createdAt = new Date(ticket.createdAt).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const isResolved = ticket.status === 'resolved'

  // Serialize messages for client component
  type SerializedMessage = {
    id: string
    authorRole: 'customer' | 'admin' | 'seller'
    body: string
    createdAt: string
    attachments: Array<{
      id: string
      mediaAsset: {
        id: string
        url: string
        originalName: string | null
        mimeType: string | null
      }
    }>
  }

  const serializedMessages: SerializedMessage[] = (ticket.messages ?? []).map((msg) => ({
    id: msg.id,
    authorRole: msg.authorRole as 'customer' | 'admin' | 'seller',
    body: msg.body,
    createdAt: msg.createdAt.toISOString(),
    attachments: (msg.attachments ?? []).map((att) => ({
      id: att.id,
      mediaAsset: {
        id: att.mediaAsset.id,
        url: att.mediaAsset.url,
        originalName: att.mediaAsset.originalName ?? null,
        mimeType: att.mediaAsset.mimeType ?? null,
      },
    })),
  }))

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href={`/siparis/${orderId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Siparişe dön
      </Link>

      <div className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--color-primary)' }}>
              {ticket.subject}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              <span>Sipariş #{orderLabel}</span>
              <span>·</span>
              <span>{categoryLabel}</span>
              <span>·</span>
              <span>{createdAt}</span>
            </div>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      <section
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="p-5">
          <TicketThreadClient
            ticketId={ticketId}
            initialMessages={serializedMessages}
            isResolved={isResolved}
          />
        </div>

        {isResolved ? (
          <div
            className="flex items-center gap-2 rounded-b-xl border-t px-5 py-4 text-sm"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-muted)',
            }}
          >
            <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
            <span style={{ color: 'var(--color-muted-fg)' }}>
              Bu destek talebi çözümlendi.
            </span>
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link href={`/siparis/${orderId}/destek/yeni`}>Yeni Destek Talebi Aç</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
