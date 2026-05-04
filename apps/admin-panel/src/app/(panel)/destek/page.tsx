import type { Metadata } from 'next'
import Link from 'next/link'
import { MessageSquareText } from 'lucide-react'
import { PageHeader, StatusBadge } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createSupportTicketService } from '@hanuja/api/services/support-ticket.service'
import { getAdminSession } from '@/lib/admin-session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Destek Talepleri',
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

export default async function AdminSupportTicketsPage() {
  await getAdminSession()

  const service = createSupportTicketService({ prisma: createPrismaForRoute() })
  const tickets = await service.listForAdmin()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Destek Talepleri"
        description="Satıcılardan gelen destek taleplerini inceleyin, yanıtlayın ve çözümleyin."
      />

      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div
          className="flex items-center gap-2 border-b px-5 py-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <MessageSquareText className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-primary)' }}>
            Tüm Talepler
          </h2>
        </div>

        {tickets.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Henüz destek talebi yok.
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {tickets.map((ticket) => {
              const lastMessage = ticket.messages[0]
              return (
                <Link
                  key={ticket.id}
                  href={`/destek/${ticket.id}`}
                  className="block px-5 py-4 transition-colors hover:bg-[var(--color-muted)]"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
                          {ticket.subject}
                        </p>
                        <StatusBadge status={ticket.status} />
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{
                            backgroundColor: 'var(--color-muted)',
                            color: 'var(--color-muted-fg)',
                          }}
                        >
                          {ticket.seller.displayName}
                        </span>
                        {ticket.orderId && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--color-muted)',
                              color: 'var(--color-muted-fg)',
                            }}
                          >
                            Sipariş #{ticket.orderId.slice(-8).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                        {lastMessage?.body ?? 'Mesaj bulunamadı.'}
                      </p>
                    </div>

                    <div className="shrink-0 text-sm md:text-right" style={{ color: 'var(--color-muted-fg)' }}>
                      <p>{formatDate(ticket.updatedAt)}</p>
                      {lastMessage?.author && (
                        <p className="text-xs">
                          Son yanıt: {lastMessage.author.name ?? lastMessage.author.email ?? 'Kullanıcı'}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
