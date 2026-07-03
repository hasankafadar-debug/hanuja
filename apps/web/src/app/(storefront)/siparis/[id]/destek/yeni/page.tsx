import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createCustomerSupportTicketService } from '@hanuja/api/services/customer-support-ticket.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { NewTicketForm } from '../_components/new-ticket-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Destek Talebi Aç',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function NewSupportTicketPage({ params }: Props) {
  const { id: orderId } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect(`/giris?redirect=/siparis/${orderId}/destek/yeni`)
  }

  // Check whether the order belongs to the customer — redirect to notFound if not
  const prisma = createPrismaForRoute()
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: session.user.id },
    select: { id: true, publicNumber: true },
  })
  if (!order) notFound()

  // If there is an open ticket, redirect to it
  const svc = createCustomerSupportTicketService({ prisma })
  const openTicket = await svc.findOpenForOrder(orderId, session.user.id)
  if (openTicket) {
    redirect(`/siparis/${orderId}/destek/${openTicket.id}`)
  }

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

      <div className="mb-6">
        <h1 className="text-xl font-medium" style={{ color: '#3d3529' }}>
          Destek Talebi Aç
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Sipariş #{order.publicNumber !== null ? String(order.publicNumber).padStart(6, '0') : orderId.slice(-8).toUpperCase()} için destek talebinizi oluşturun.
        </p>
      </div>

      <section
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <NewTicketForm orderId={orderId} />
      </section>
    </div>
  )
}
