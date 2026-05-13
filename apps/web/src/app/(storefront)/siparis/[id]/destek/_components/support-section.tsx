'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@hanuja/ui'
import { HeadphonesIcon, ChevronDown, ChevronUp } from 'lucide-react'

type TicketStatus = 'waiting_for_admin' | 'waiting_for_customer' | 'resolved'

interface Ticket {
  id: string
  subject: string
  status: TicketStatus
  category: string
  createdAt: string
}

interface SupportSectionProps {
  orderId: string
}

interface ApiEnvelope<T> {
  data: T
  success: boolean
}

function StatusBadge({ status }: { status: TicketStatus }) {
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

export function SupportSection({ orderId }: SupportSectionProps) {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvedExpanded, setResolvedExpanded] = useState(false)

  useEffect(() => {
    fetch(`/api/orders/${orderId}/support-tickets`)
      .then((res) => {
        if (!res.ok) throw new Error('Destek talepleri yüklenemedi.')
        return res.json()
      })
      .then((payload: ApiEnvelope<{ tickets?: Ticket[] }>) => {
        setTickets(payload.data?.tickets ?? [])
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Bir hata oluştu.'))
      .finally(() => setLoading(false))
  }, [orderId])

  if (loading) {
    return (
      <section
        className="mt-5 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="h-5 w-40 animate-pulse rounded" style={{ backgroundColor: 'var(--color-muted)' }} />
      </section>
    )
  }

  if (error) {
    return (
      <section
        className="mt-5 rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          {error}
        </p>
      </section>
    )
  }

  const openTicket = tickets.find(
    (t) => t.status === 'waiting_for_admin' || t.status === 'waiting_for_customer',
  )
  const resolvedTickets = tickets.filter((t) => t.status === 'resolved')

  return (
    <section
      className="mt-5 rounded-xl border p-5"
      style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
    >
      <h2
        className="mb-4 flex items-center gap-2 font-semibold"
        style={{ color: 'var(--color-primary)' }}
      >
        <HeadphonesIcon className="h-4 w-4" /> Destek
      </h2>

      {openTicket ? (
        <div
          className="mb-4 rounded-lg border p-4"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 flex-wrap">
                <StatusBadge status={openTicket.status} />
                <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {new Date(openTicket.createdAt).toLocaleDateString('tr-TR', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </div>
              <p
                className="text-sm font-medium truncate"
                style={{ color: 'var(--color-primary)' }}
              >
                {openTicket.subject}
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0">
              <Link href={`/siparis/${orderId}/destek/${openTicket.id}`}>Görüntüle</Link>
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <p className="mb-3 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Siparişinizle ilgili bir sorun mu yaşıyorsunuz? Destek ekibimize ulaşın.
          </p>
          <Button asChild size="sm">
            <Link href={`/siparis/${orderId}/destek/yeni`}>Destek Al</Link>
          </Button>
        </div>
      )}

      {resolvedTickets.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setResolvedExpanded((prev) => !prev)}
            className="flex items-center gap-1 text-xs"
            style={{ color: 'var(--color-muted-fg)' }}
          >
            {resolvedExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            Çözümlenen talepler ({resolvedTickets.length})
          </button>

          {resolvedExpanded && (
            <div className="mt-3 space-y-2">
              {resolvedTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/siparis/${orderId}/destek/${ticket.id}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-muted transition-colors"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <span className="truncate" style={{ color: 'var(--color-primary)' }}>
                    {ticket.subject}
                  </span>
                  <StatusBadge status={ticket.status} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
