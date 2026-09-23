import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'
import {
  ANNOUNCEMENT_PROGRESS_LABELS,
  type AnnouncementProgressBucket,
  type AnnouncementProgressCounts,
} from '@hanuja/api/domain/announcement-progress'
import { getAdminSession } from '@/lib/admin-session'
import { NewAnnouncementButton } from './_components/new-announcement-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Duyuru', robots: { index: false, follow: false } }

function formatDate(value: Date | null): string {
  if (!value) return '—'
  return value.toLocaleString('tr-TR', {
    timeZone: 'Europe/Istanbul',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function progressSummary(progress: AnnouncementProgressCounts | null): string {
  if (!progress) return '—'
  const parts = (Object.entries(progress) as [AnnouncementProgressBucket, number][])
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${ANNOUNCEMENT_PROGRESS_LABELS[bucket]} ${count}`)
  return parts.length ? parts.join(' · ') : 'Kayıt yok'
}

export default async function AnnouncementsListPage({
  searchParams,
}: {
  searchParams: Promise<{ sayfa?: string }>
}) {
  await getAdminSession()
  const { sayfa } = await searchParams
  const page = Math.max(1, Number.parseInt(sayfa ?? '1', 10) || 1)
  const service = createAnnouncementService({ prisma: createPrismaForRoute() })
  const data = await service.listForAdmin(page)
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Duyuru"
        description="Satıcılara panelde ve e-posta ile gönderilen duyuruları oluşturun ve gönderim durumlarını takip edin."
        actions={<NewAnnouncementButton />}
      />

      <div
        className="overflow-x-auto rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              className="border-b text-left text-xs uppercase tracking-wide"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
            >
              <th className="px-4 py-3">Başlık</th>
              <th className="px-4 py-3">Durum</th>
              <th className="px-4 py-3">Alıcı sayısı</th>
              <th className="px-4 py-3">İlerleme</th>
              <th className="px-4 py-3">Gönderim tarihi</th>
              <th className="px-4 py-3">Oluşturma tarihi</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center" style={{ color: 'var(--color-muted-fg)' }}>
                  Henüz duyuru oluşturulmadı.
                </td>
              </tr>
            ) : (
              data.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t hover:bg-[var(--color-muted)]"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="px-4 py-3">
                    <Link href={`/duyurular/${row.id}`} className="font-medium underline-offset-2 hover:underline" style={{ color: 'var(--color-primary)' }}>
                      {row.title.trim() || 'Başlıksız taslak'}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: row.status === 'sent' ? 'var(--color-success)' : 'var(--color-muted)',
                        color: row.status === 'sent' ? 'white' : 'var(--color-muted-fg)',
                      }}
                    >
                      {row.status === 'sent' ? 'Gönderildi' : 'Taslak'}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.recipientCount}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {row.status === 'sent' ? progressSummary(row.progress) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(row.sentAt)}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {formatDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-sm">
        {page > 1 && (
          <Link href={`/duyurular?sayfa=${page - 1}`} style={{ color: 'var(--color-primary)' }}>
            Önceki
          </Link>
        )}
        {page < totalPages && (
          <Link href={`/duyurular?sayfa=${page + 1}`} style={{ color: 'var(--color-primary)' }}>
            Sonraki
          </Link>
        )}
      </div>
    </div>
  )
}
