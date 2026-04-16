import type { Metadata } from 'next'
import Link from 'next/link'
import { Button, StatusBadge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Uyuşmazlıklar' }

export default async function DisputesAdminPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()
  const disputes = await prisma.dispute.findMany({
    include: {
      order: {
        include: {
          customer: { select: { name: true } },
          lines: { select: { sellerId: true }, take: 1 },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Resolve seller display names via sellerIds from order lines
  const sellerIds = [...new Set(disputes.flatMap((d) => d.order?.lines.map((l) => l.sellerId) ?? []))]
  const sellers = sellerIds.length
    ? await prisma.seller.findMany({ where: { id: { in: sellerIds } }, select: { id: true, displayName: true } })
    : []
  const sellerMap = new Map(sellers.map((s) => [s.id, s.displayName]))

  const openCount = disputes.filter((d) => d.status === 'open' || d.status === 'under_review').length

  const fmt = (d: Date) =>
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-6">
      <PageHeader title="Uyuşmazlıklar" description={`${openCount} açık uyuşmazlık`} />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Önemli:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          Açık uyuşmazlıklar ilgili siparişin hakedişini bloke eder.
          Müşteri lehine çözümde ödeme iadesi tetiklenir; satıcı lehine çözümde hakediş serbest kalır.
        </span>
      </div>

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm whitespace-nowrap">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Uyuşmazlık', 'Sipariş', 'Satıcı', 'Müşteri', 'Sebep', 'Açılış', 'Durum', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {disputes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Henüz uyuşmazlık yok.
                </td>
              </tr>
            )}
            {disputes.map((d) => {
              const sellerId = d.order?.lines[0]?.sellerId
              const sellerName = sellerId ? (sellerMap.get(sellerId) ?? '—') : '—'
              const customerName = d.order?.customer?.name ?? '—'
              return (
                <tr
                  key={d.id}
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {d.id.slice(0, 8)}…
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/siparisler/${d.orderId}`}
                      className="hover:underline font-medium"
                      style={{ color: 'var(--color-accent)' }}
                    >
                      {d.orderId.slice(0, 10)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {sellerName}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {customerName}
                  </td>
                  <td
                    className="px-4 py-3 max-w-[180px] truncate"
                    style={{ color: 'var(--color-muted-fg)' }}
                    title={d.reason}
                  >
                    {d.reason}
                  </td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>
                    {fmt(d.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={d.status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/uyusmazliklar/${d.id}`}>
                      <Button size="sm" variant="outline">İncele</Button>
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
