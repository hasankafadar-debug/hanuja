import type { Metadata } from 'next'
import Link from 'next/link'
import type { ProductReviewStatus } from '@prisma/client'
import { PageHeader, StatusBadge } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createProductReviewService } from '@hanuja/api/services/product-review.service'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import ModerateActions from './_components/moderate-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Yorum Moderasyonu' }

const VALID_STATUS: ReadonlySet<ProductReviewStatus> = new Set([
  'pending_moderation',
  'approved',
  'rejected',
])

const STATUS_FILTERS: Array<{ key: ProductReviewStatus | 'all'; label: string }> = [
  { key: 'pending_moderation', label: 'Bekleyen' },
  { key: 'approved', label: 'Onaylı' },
  { key: 'rejected', label: 'Reddedilmiş' },
  { key: 'all', label: 'Tümü' },
]

interface Props {
  searchParams: Promise<{ status?: string }>
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function ReviewModerationPage({ searchParams }: Props) {
  await getAdminSession()
  const sp = await searchParams
  const filter: ProductReviewStatus | undefined =
    sp.status && VALID_STATUS.has(sp.status as ProductReviewStatus)
      ? (sp.status as ProductReviewStatus)
      : 'pending_moderation'

  const prisma = createPrismaForRoute()
  const svc = createProductReviewService({ prisma })
  const { rows, total } = await svc.listForAdmin({
    ...(filter !== undefined ? { status: filter } : {}),
    skip: 0,
    take: 50,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Yorum Moderasyonu"
        description={`${total} yorum (filtre: ${filter ?? 'tümü'})`}
      />

      <div
        className="rounded-xl border p-4 text-sm"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-muted)' }}
      >
        <strong style={{ color: 'var(--color-primary)' }}>Moderasyon politikası:</strong>{' '}
        <span style={{ color: 'var(--color-muted-fg)' }}>
          06-content-guidelines uyarınca yalnızca onaylı yorumlar ürün sayfasında görünür ve
          ortalama puanı etkiler. Reddedilen yorumlar tarihçede kalır, müşteriye gerekçe bildirilir.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = (filter ?? 'all') === f.key
          const href = f.key === 'all' ? '/yorumlar?status=all' : `/yorumlar?status=${f.key}`
          return (
            <Link
              key={f.key}
              href={href}
              className="rounded-md border px-3 py-1 text-sm"
              style={{
                borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
                color: active ? 'var(--color-accent)' : 'var(--color-muted-fg)',
                backgroundColor: active ? 'var(--color-muted)' : 'transparent',
              }}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      <div
        className="rounded-xl border overflow-x-auto"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm whitespace-nowrap">
          <thead style={{ backgroundColor: 'var(--color-muted)' }}>
            <tr>
              {['Tarih', 'Ürün', 'Müşteri', 'Puan', 'Yorum', 'Durum', 'İşlem'].map((h) => (
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
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm"
                  style={{ color: 'var(--color-muted-fg)' }}
                >
                  Bu filtreye uyan yorum yok.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t align-top hover:bg-[var(--color-muted)]"
                style={{ borderColor: 'var(--color-border)' }}
              >
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  {fmtDate(r.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/urunler/${r.product.id}`}
                    className="font-medium hover:underline"
                    style={{ color: 'var(--color-accent)' }}
                  >
                    {r.product.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                  <div>{r.customer.name ?? '-'}</div>
                  <div className="font-mono text-[10px]">{r.customer.email}</div>
                </td>
                <td className="px-4 py-3 text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                  {r.rating} / 5
                </td>
                <td
                  className="px-4 py-3 text-xs whitespace-pre-line"
                  style={{ color: 'var(--color-muted-fg)', maxWidth: 360 }}
                >
                  {r.title && (
                    <div className="font-semibold mb-1" style={{ color: 'var(--color-primary)' }}>
                      {r.title}
                    </div>
                  )}
                  <div>{r.body.length > 280 ? `${r.body.slice(0, 280)}…` : r.body}</div>
                  {r.moderationNote && (
                    <div className="mt-1 text-[10px]" style={{ color: 'var(--color-muted-fg)' }}>
                      Not: {r.moderationNote}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3" style={{ minWidth: 220 }}>
                  {r.status === 'pending_moderation' ? (
                    <ModerateActions reviewId={r.id} />
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {r.moderatedAt ? fmtDate(r.moderatedAt) : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
