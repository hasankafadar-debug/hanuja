import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { Button, PageHeader, StatusBadge } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'
import { getAdminSession } from '@/lib/admin-session'
import { AdminTicketActions } from '../_components/admin-ticket-actions'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Destek Talebi ${id.slice(-6).toUpperCase()}`,
  }
}

function formatDate(date: Date) {
  return date.toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ROLE_LABELS: Record<string, string> = {
  seller: 'Satıcı',
  admin: 'Admin',
}

export default async function AdminSupportTicketDetailPage({ params }: Props) {
  await getAdminSession()

  const { id } = await params
  const service = createSupportTicketService({ prisma: createPrismaForRoute() })
  const ticket = await service.getForAdmin(id).catch(() => null)

  if (!ticket) notFound()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href="/destek"
          className="mb-4 inline-flex items-center gap-1.5 text-sm"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Destek Taleplerine Dön
        </Link>
        <PageHeader title={ticket.subject} description="Satıcı destek talebi detayı" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <div
            className="rounded-xl border p-5"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={ticket.status} />
                  {ticket.orderId && (
                    <Link href={`/siparisler/${ticket.orderId}`}>
                      <Button type="button" size="sm" variant="outline">
                        Sipariş #{ticket.orderId.slice(-8).toUpperCase()}
                      </Button>
                    </Link>
                  )}
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-2">
                  <div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>Satıcı</p>
                    <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {ticket.seller.displayName}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>Mağaza Yetkilisi</p>
                    <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {ticket.seller.user.name ?? ticket.seller.user.email ?? 'Belirtilmemiş'}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>Oluşturulma</p>
                    <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatDate(ticket.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p style={{ color: 'var(--color-muted-fg)' }}>Son Güncelleme</p>
                    <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                      {formatDate(ticket.updatedAt)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            className="rounded-xl border"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <div
              className="border-b px-5 py-4 text-base font-semibold"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              Mesaj Geçmişi
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {ticket.messages.map((message) => {
                const isAdmin = message.authorRole === 'admin'
                return (
                  <div
                    key={message.id}
                    className="space-y-2 px-5 py-4"
                    style={{
                      backgroundColor: isAdmin ? 'var(--color-muted)' : 'transparent',
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                          {message.author.name ?? message.author.email ?? 'Kullanıcı'}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                          {ROLE_LABELS[message.authorRole] ?? message.authorRole}
                        </span>
                      </div>
                      <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                        {formatDate(message.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm leading-6" style={{ color: 'var(--color-primary)' }}>
                      {message.body}
                    </p>
                    {message.attachments.length > 0 ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {message.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={attachment.mediaAsset.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            {attachment.mediaAsset.originalName ?? 'Dosya eki'}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <AdminTicketActions ticketId={ticket.id} isResolved={ticket.status === 'resolved'} />
      </div>
    </div>
  )
}
