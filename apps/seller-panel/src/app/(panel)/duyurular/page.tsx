import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { ImageIcon, Megaphone, PlayCircle } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'
import { getSellerFromSession } from '@/lib/seller-session'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Duyurular',
}

function formatDate(value: Date | null) {
  if (!value) return ''
  return value.toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  })
}

function pageHref(page: number) {
  return page > 1 ? `/duyurular?sayfa=${page}` : '/duyurular'
}

interface Props {
  searchParams: Promise<{ sayfa?: string }>
}

export default async function AnnouncementsPage({ searchParams }: Props) {
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const { sayfa } = await searchParams
  const { rows, page, pageSize, total } = await createAnnouncementService({
    prisma: createPrismaForRoute(),
  }).listForSeller(seller.id, Number.parseInt(sayfa ?? '1', 10) || 1)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duyurular"
        description="Hanuja'nın mağazanıza gönderdiği operasyon duyuruları. Her duyuru e-posta adresinize de gönderilir."
      />

      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <Megaphone className="h-8 w-8" style={{ color: 'var(--color-muted-fg)' }} aria-hidden="true" />
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              Henüz duyuru yok
            </p>
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Hanuja mağazanıza bir duyuru gönderdiğinde burada görünür.
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/duyurular/${row.id}`}
                  className="flex flex-col gap-1 px-5 py-4 transition-colors hover:bg-[var(--color-muted)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                      {row.mediaKind === 'video' ? (
                        <PlayCircle className="h-4 w-4 shrink-0" aria-label="Videolu duyuru" />
                      ) : row.mediaKind === 'image' ? (
                        <ImageIcon className="h-4 w-4 shrink-0" aria-label="Görselli duyuru" />
                      ) : null}
                      <span className="truncate">{row.title}</span>
                    </p>
                    <time className="shrink-0 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {formatDate(row.sentAt)}
                    </time>
                  </div>
                  <p className="line-clamp-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    {row.excerpt}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {row.unread ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">Okunmadı</span>
                    ) : null}
                    {row.edited ? (
                      <span
                        className="rounded-full border px-2 py-0.5"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                      >
                        Güncellendi
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Sayfalar">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="rounded-md border px-3 py-1.5 hover:bg-[var(--color-muted)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              Önceki
            </Link>
          ) : (
            <span />
          )}
          <span style={{ color: 'var(--color-muted-fg)' }}>
            Sayfa {page} / {totalPages} · {total} duyuru
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="rounded-md border px-3 py-1.5 hover:bg-[var(--color-muted)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              Sonraki
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  )
}
