import type { Metadata } from 'next'
import { Badge, PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { ProductModerationActions } from '@/components/product-moderation-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Ürün Moderasyon' }

const STATUS_MAP: Record<string, { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }> = {
  pending_review: { label: 'İnceleme Bekliyor', variant: 'warning' },
  published: { label: 'Onaylandı', variant: 'success' },
  rejected: { label: 'Reddedildi', variant: 'destructive' },
  draft: { label: 'Taslak', variant: 'secondary' },
  unlisted: { label: 'Yayından Kaldırıldı', variant: 'secondary' },
}

export default async function ProductModerationPage() {
  await getAdminSession()

  const prisma = createPrismaForRoute()

  // Show pending_review first, then recently reviewed
  const products = await prisma.product.findMany({
    where: { status: { in: ['pending_review', 'published', 'rejected'] } },
    include: {
      seller: { select: { displayName: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  })

  const pendingCount = products.filter((p) => p.status === 'pending_review').length

  const fmt = (d: Date) =>
    d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-6">
      <PageHeader title="Ürün Moderasyon" description={`${pendingCount} onay bekliyor`} />

      <div className="rounded-xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <table className="w-full text-sm whitespace-nowrap">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Ürün', 'Satıcı', 'Kategori', 'Gönderim', 'Durum', ''].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted-fg)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                  Onay bekleyen ürün yok.
                </td>
              </tr>
            )}
            {products.map((p) => {
              const statusInfo = STATUS_MAP[p.status]
              const sellerName = p.seller?.displayName ?? '—'
              const categoryName = p.category?.name ?? '—'
              return (
                <tr key={p.id} className="border-t hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3 font-medium" style={{ color: 'var(--color-primary)' }}>{p.name}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{sellerName}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{categoryName}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-muted-fg)' }}>{fmt(p.createdAt)}</td>
                  <td className="px-4 py-3">
                    {statusInfo && <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>}
                  </td>
                  <td className="px-4 py-3">
                    {p.status === 'pending_review' && (
                      <ProductModerationActions productId={p.id} />
                    )}
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
