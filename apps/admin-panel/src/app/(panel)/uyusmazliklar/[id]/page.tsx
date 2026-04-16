import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button, StatusBadge, PageHeader } from '@hanuja/ui'
import { ArrowLeft, MessageSquare, AlertTriangle } from 'lucide-react'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

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
    },
  })

  if (!dispute) notFound()

  // Resolve seller display name
  const sellerId = dispute.order?.lines[0]?.sellerId
  let sellerName = '—'
  if (sellerId) {
    const seller = await prisma.seller.findUnique({ where: { id: sellerId }, select: { displayName: true } })
    sellerName = seller?.displayName ?? '—'
  }
  const customerName = dispute.order?.customer?.name ?? '—'

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

      {/* Durum Kartı */}
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
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>Çözüm</span>
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

      {/* Mesajlar */}
      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <MessageSquare className="h-4 w-4" style={{ color: 'var(--color-muted-fg)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
            Mesajlar ({dispute.messages.length})
          </span>
        </div>
        {dispute.messages.length === 0 && (
          <p className="px-5 py-4 text-sm" style={{ color: 'var(--color-muted-fg)' }}>Henüz mesaj yok.</p>
        )}
        <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
          {dispute.messages.map((msg) => (
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
            </div>
          ))}
        </div>
      </div>

      {/* Admin Çözüm Aksiyonları */}
      {(dispute.status === 'open' || dispute.status === 'under_review') && (
        <div
          className="rounded-xl border p-5 space-y-4"
          style={{ borderColor: 'var(--color-warning)', backgroundColor: '#fffbeb' }}
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            <span className="text-sm font-semibold" style={{ color: '#92400e' }}>
              Uyuşmazlığı Çöz
            </span>
          </div>
          <p className="text-xs" style={{ color: '#92400e' }}>
            Bu işlem geri alınamaz. Müşteri lehine çözümde ödeme iadesi başlatılır ve hakediş kalıcı bloke edilir.
            Satıcı lehine çözümde hakediş serbest kalır.
          </p>
          <div className="flex items-center gap-3">
            <form action={`/api/admin/disputes/${id}/resolve`} method="POST">
              <input type="hidden" name="resolutionType" value="resolved_for_customer" />
              <input type="hidden" name="resolution" value="Admin kararıyla müşteri lehine çözüldü" />
              <Button type="submit" size="sm" variant="destructive">
                Müşteri Lehine Çöz
              </Button>
            </form>
            <form action={`/api/admin/disputes/${id}/resolve`} method="POST">
              <input type="hidden" name="resolutionType" value="resolved_for_seller" />
              <input type="hidden" name="resolution" value="Admin kararıyla satıcı lehine çözüldü" />
              <Button type="submit" size="sm" variant="outline">
                Satıcı Lehine Çöz
              </Button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
