import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { Button, StatusBadge, PageHeader, normalizeMediaDisplayUrl } from '@hanuja/ui'
import { ArrowLeft, MessageSquare, AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { DisputeResolveForm } from './_components/dispute-resolve-form'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Uyuşmazlık Detayı' }

export default async function DisputeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await getAdminSession()

  const { id } = await params
  const prisma = createPrismaForRoute()

  const dispute = await prisma.dispute.findUnique({
    where: { id },
    include: {
      order: {
        include: {
          customer: { select: { name: true } },
          lines: { select: { sellerId: true }, take: 1 },
        },
      },
      messages: { orderBy: { createdAt: 'asc' } },
      escalatedFromReturn: {
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            include: { attachments: true },
          },
          evidence: true,
        },
      },
    },
  })

  if (!dispute) notFound()

  const sellerId = dispute.order?.lines[0]?.sellerId
  let sellerName = '—'
  if (sellerId) {
    const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { displayName: true } })
    sellerName = seller?.displayName ?? '—'
  }
  const customerName = dispute.order?.customer?.name ?? '—'
  const rr = dispute.escalatedFromReturn

  const fmt = (d: Date) =>
    d.toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const roleColors: Record<string, string> = {
    customer: 'var(--color-accent)',
    seller: 'var(--color-success)',
    admin: 'var(--color-warning)',
  }
  const roleLabels: Record<string, string> = {
    customer: 'Müşteri',
    seller: 'Satıcı',
    admin: 'Admin',
  }

  // Eskale edilen iade varsa konuşma return thread'inde tutulur
  const thread = rr
    ? rr.messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole as string,
        body: m.body,
        createdAt: m.createdAt,
        attachments: m.attachments.map((a) => ({ id: a.id, url: a.url })),
      }))
    : dispute.messages.map((m) => ({
        id: m.id,
        authorRole: m.authorRole as string,
        body: m.body,
        createdAt: m.createdAt,
        attachments: [] as { id: string; url: string }[],
      }))

  const canResolve = dispute.status === 'open' || dispute.status === 'under_review'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/uyusmazliklar">
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Geri
          </Button>
        </Link>
        <PageHeader title="Uyuşmazlık" description={dispute.reason} />
      </div>

      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <StatusBadge status={dispute.status} />
            {dispute.payoutBlocked && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}
              >
                <AlertTriangle className="h-3 w-3" />
                Hakediş Bloke
              </span>
            )}
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
            {fmt(dispute.createdAt)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Sipariş</span>
            <p>
              <Link href={`/siparisler/${dispute.orderId}`} className="hover:underline font-medium" style={{ color: 'var(--color-accent)' }}>
                {dispute.orderId.slice(0, 12)}…
              </Link>
            </p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Satıcı</span>
            <p className="font-medium" style={{ color: 'var(--color-primary)' }}>{sellerName}</p>
          </div>
          <div>
            <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Müşteri</span>
            <p className="font-medium" style={{ color: 'var(--color-primary)' }}>{customerName}</p>
          </div>
          {dispute.resolution && (
            <div>
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Sonuç</span>
              <p className="text-sm" style={{ color: 'var(--color-primary)' }}>{dispute.resolution}</p>
            </div>
          )}
        </div>

        {dispute.description && (
          <div
            className="rounded-lg p-3 text-sm"
            style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-muted-fg)' }}
          >
            {dispute.description}
          </div>
        )}
      </div>

      {rr ? (
        <div
          className="rounded-xl border p-5 space-y-3 text-sm"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
        >
          <p className="font-semibold" style={{ color: 'var(--color-primary)' }}>
            İade Bilgisi (#{rr.id.slice(-8).toUpperCase()})
          </p>
          <p style={{ color: 'var(--color-muted-fg)' }}>
            <strong style={{ color: 'var(--color-primary)' }}>Müşteri sebebi:</strong> {rr.reason}
          </p>
          {rr.description ? <p style={{ color: 'var(--color-muted-fg)' }}>{rr.description}</p> : null}
          {rr.returnCargoProvider || rr.returnTrackingNumber ? (
            <p style={{ color: 'var(--color-muted-fg)' }}>
              <strong style={{ color: 'var(--color-primary)' }}>Müşteri iade kargosu:</strong>{' '}
              {rr.returnCargoProvider} {rr.returnTrackingNumber}
            </p>
          ) : null}
          {rr.sellerRejectReason ? (
            <div
              className="rounded-lg p-3"
              style={{ backgroundColor: '#fef2f2', color: '#dc2626' }}
            >
              <strong>Satıcı red sebebi:</strong> {rr.sellerRejectReason}
              {rr.sellerRejectDescription ? <p className="mt-1">{rr.sellerRejectDescription}</p> : null}
            </div>
          ) : null}
          {rr.evidence.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {rr.evidence.map((e) => (
                <a key={e.id} href={e.url} target="_blank" rel="noreferrer">
                  <span className="relative block h-16 w-16 overflow-hidden rounded border" style={{ borderColor: 'var(--color-border)' }}>
                    <Image src={normalizeMediaDisplayUrl(e.url)} alt="Kanıt" fill className="object-cover" />
                  </span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <MessageSquare className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Yazışma ({thread.length})
          </span>
        </div>
        {thread.length === 0 && (
          <p className="px-5 py-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>Henüz mesaj yok.</p>
        )}
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {thread.map((msg) => (
            <div key={msg.id} className="px-5 py-4 space-y-1">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: roleColors[msg.authorRole] ?? 'var(--color-muted-fg)' }}
                >
                  {roleLabels[msg.authorRole] ?? msg.authorRole}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {fmt(msg.createdAt)}
                </span>
              </div>
              <p className="text-sm" style={{ color: 'var(--color-primary)' }}>
                {msg.body}
              </p>
              {msg.attachments.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {msg.attachments.map((a) => (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                      <span className="relative block h-14 w-14 overflow-hidden rounded border" style={{ borderColor: 'var(--color-border)' }}>
                        <Image src={normalizeMediaDisplayUrl(a.url)} alt="Ek" fill className="object-cover" />
                      </span>
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <DisputeResolveForm
        disputeId={dispute.id}
        returnRequestId={rr?.id ?? null}
        canResolve={canResolve}
      />
    </div>
  )
}
