import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createNotificationOperationsService } from '@hanuja/api/services/notification-operations.service'
import { getAdminSession } from '@/lib/admin-session'
import { RetryButton } from './retry-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'E-posta Gönderimleri' }
const labels: Record<string, string> = {
  pending: 'Bekliyor',
  queued: 'Kuyrukta',
  processing: 'İşleniyor',
  sent: 'İşlendi',
  failed: 'Başarısız',
  completed: 'Tamamlandı',
  unknown: 'Teslim bilgisi yok',
  delivered: 'Alıcı sunucuya teslim',
  bounced: 'Geri döndü',
  complained: 'Spam bildirimi',
  uncertain: 'Sonuç belirsiz — inceleme gerekli',
  simulated: 'Geliştirme simülasyonu',
  skipped: 'Gönderilmedi',
}
const date = (value: Date | null) =>
  value?.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) ?? '—'

export default async function EmailOperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; failed?: string }>
}) {
  const session = await getAdminSession()
  const query = await searchParams
  const page = Math.min(
    10000,
    Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1),
  )
  const failed = query.failed === '1'
  const data = await createNotificationOperationsService(
    createPrismaForRoute(),
  ).list(session.user.id, page, failed)
  return (
    <div className="space-y-6">
      <PageHeader
        title="E-posta Gönderimleri"
        description="Kuyruk, SMTP kabulü ve sağlayıcı teslim sonuçlarını takip edin."
      />
      <p className="text-sm">
        SMTP kabulü, gelen kutusuna teslim anlamına gelmez. Belirsiz sonuçlar
        otomatik yeniden gönderilmez. Eski kayıtların tam içeriği bulunmuyorsa
        yeniden deneme kapalıdır.
      </p>
      <div className="flex gap-4 text-sm">
        <Link href="/e-posta">Tüm kayıtlar</Link>
        <Link href="/e-posta?failed=1">Başarısız kayıtlar</Link>
      </div>
      <section className="overflow-x-auto rounded-xl border bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 font-semibold">
          Gönderim kayıtları ({data.count})
        </h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                'Olay / zaman',
                'Alıcı / kanal',
                'Durum / deneme',
                'SMTP kabulü / teslim',
                'Hata / işlem',
              ].map((x) => (
                <th className="p-2" key={x}>
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.deliveries.map((row) => (
              <tr className="border-t align-top" key={row.id}>
                <td className="p-2">
                  {row.type}
                  <br />
                  <span className="text-xs">{date(row.createdAt)}</span>
                </td>
                <td className="p-2 break-all">
                  {row.recipient}
                  <br />
                  {row.channel === 'email' ? 'E-posta' : 'Uygulama içi'}
                </td>
                <td className="p-2">
                  {labels[row.status] ?? row.status} · {row.attemptCount}
                  <br />
                  {row.channel === 'email' && labels[row.transportStatus]}
                </td>
                <td className="p-2">
                  {date(row.smtpAcceptedAt)}
                  <br />
                  {date(
                    row.channel === 'email' &&
                      row.transportStatus !== 'delivered'
                      ? null
                      : row.deliveredAt,
                  )}
                </td>
                <td className="p-2">
                  <p className="mb-2 break-all">{row.lastError}</p>
                  {row.canRetry && <RetryButton id={row.id} kind="delivery" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.deliveries.length && (
          <p className="py-6">Bu filtrede kayıt yok.</p>
        )}
        <div className="mt-4 flex gap-4">
          {page > 1 && (
            <Link href={`/e-posta?page=${page - 1}&failed=${failed ? 1 : 0}`}>
              Önceki
            </Link>
          )}
          {page * 30 < data.count && (
            <Link href={`/e-posta?page=${page + 1}&failed=${failed ? 1 : 0}`}>
              Sonraki
            </Link>
          )}
        </div>
      </section>
      <section className="rounded-xl border bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 font-semibold">
          Bekleyen / başarısız olaylar (ilk 30)
        </h2>
        {data.outbox.map((row) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm"
            key={row.id}
          >
            <div>
              {row.type} · {labels[row.status]} · {date(row.createdAt)}
              <p>{row.lastError}</p>
            </div>
            {row.status === 'failed' && (
              <RetryButton id={row.id} kind="outbox" />
            )}
          </div>
        ))}
        {!data.outbox.length && <p className="text-sm">Bekleyen olay yok.</p>}
      </section>
    </div>
  )
}
