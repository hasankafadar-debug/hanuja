import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCustomerSupportTicketService } from '@hanuja/api/services/customer-support-ticket.service'
import { getAdminSession } from '@/lib/admin-session'
import { CustomerTicketActions } from '../_components/customer-ticket-actions'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Müşteri Destek #${id.slice(-6).toUpperCase()}`,
    robots: { index: false, follow: false },
  }
}

const STATUS_LABELS: Record<string, string> = {
  waiting_for_admin: 'İnceleniyor',
  waiting_for_customer: 'Yanıt bekleniyor',
  resolved: 'Çözümlendi',
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  waiting_for_admin: { bg: '#fffbeb', color: '#92400e' },
  waiting_for_customer: { bg: '#eff6ff', color: '#1e40af' },
  resolved: { bg: '#f0fdf4', color: '#166534' },
}

const CATEGORY_LABELS: Record<string, string> = {
  shipping_delay: 'Kargo gecikmesi',
  damaged_product: 'Ürün hasarlı',
  wrong_product: 'Yanlış ürün',
  invoice_issue: 'Fatura sorunu',
  payment_issue: 'Ödeme sorunu',
  return_or_exchange: 'İade & Değişim',
  other: 'Diğer',
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusChip({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status
  const style = STATUS_STYLES[status] ?? { bg: 'var(--color-muted)', color: 'var(--color-muted-fg)' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.color }}
    >
      {label}
    </span>
  )
}

export default async function CustomerSupportTicketDetailPage({ params }: Props) {
  await getAdminSession()

  const { id } = await params
  const svc = createCustomerSupportTicketService({ prisma: createPrismaForRoute() })
  const ticket = await svc.getByIdForAdmin(id).catch(() => null)

  if (!ticket) notFound()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Başlık */}
      <div className="flex items-center gap-3">
        <Link
          href="/musteri-destek"
          className="flex items-center gap-1 text-sm hover:underline"
          style={{ color: 'var(--color-muted-fg)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Müşteri Destek
        </Link>
      </div>

      <PageHeader
        title={`Talep: ${ticket.subject}`}
        description={`#${ticket.id.slice(-8).toUpperCase()} · ${CATEGORY_LABELS[ticket.category] ?? ticket.category}`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sol: Thread + yanıt */}
        <div className="space-y-4 lg:col-span-2">
          {/* Mesaj thread'i */}
          <div
            className="divide-y rounded-xl border"
            style={{
              borderColor: 'var(--color-border)',
              backgroundColor: 'var(--color-surface)',
            }}
          >
            {ticket.messages.length === 0 && (
              <p className="px-5 py-6 text-sm text-center" style={{ color: 'var(--color-muted-fg)' }}>
                Henüz mesaj yok.
              </p>
            )}
            {ticket.messages.map((msg) => {
              const isAdmin = msg.authorRole === 'admin'
              return (
                <div key={msg.id} className="p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                      {isAdmin ? `Admin (${msg.author?.name ?? 'Sistem'})` : (msg.author?.name ?? 'Müşteri')}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatDate(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className={`rounded-lg p-3 text-sm whitespace-pre-wrap ${isAdmin ? 'ml-8' : 'mr-8'}`}
                    style={{
                      backgroundColor: isAdmin ? 'var(--color-muted)' : '#eff6ff',
                      color: 'var(--color-primary)',
                    }}
                  >
                    {msg.body}
                  </div>
                  {msg.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {msg.attachments.map((att) => (
                        <a
                          key={att.id}
                          href={att.mediaAsset.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs hover:underline"
                          style={{ color: 'var(--color-accent)' }}
                        >
                          <Paperclip className="h-3 w-3" />
                          {att.mediaAsset.originalName ?? 'Ek dosya'}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Yanıt + çözümleme */}
          <CustomerTicketActions ticketId={ticket.id} isResolved={ticket.status === 'resolved'} />
        </div>

        {/* Sağ: Meta bilgiler */}
        <div className="space-y-4">
          <div
            className="rounded-xl border p-5 space-y-4 text-sm"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
          >
            <h3 className="font-semibold text-base" style={{ color: 'var(--color-primary)' }}>
              Talep Bilgileri
            </h3>

            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Durum</p>
                <StatusChip status={ticket.status} />
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Kategori</p>
                <p style={{ color: 'var(--color-primary)' }}>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Konu</p>
                <p style={{ color: 'var(--color-primary)' }}>{ticket.subject}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Oluşturulma</p>
                <p style={{ color: 'var(--color-primary)' }}>{formatDate(ticket.createdAt)}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Sipariş</p>
                <Link
                  href={`/siparisler/${ticket.orderId}`}
                  className="hover:underline font-mono text-xs"
                  style={{ color: 'var(--color-accent)' }}
                >
                  #{ticket.order?.publicNumber ?? ticket.orderId.slice(-8).toUpperCase()}
                </Link>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Müşteri</p>
                <p style={{ color: 'var(--color-primary)' }}>{ticket.customer?.name ?? '—'}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>{ticket.customer?.email ?? ''}</p>
              </div>

              {ticket.status === 'resolved' && ticket.resolvedBy && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide mb-0.5" style={{ color: 'var(--color-muted-fg)' }}>Çözümleyen</p>
                  <p style={{ color: 'var(--color-primary)' }}>{ticket.resolvedBy.name}</p>
                  {ticket.resolvedAt && (
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted-fg)' }}>{formatDate(ticket.resolvedAt)}</p>
                  )}
                  {ticket.resolutionNote && (
                    <p className="mt-1 text-xs rounded p-2" style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-primary)' }}>
                      {ticket.resolutionNote}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
