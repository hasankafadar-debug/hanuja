import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '@hanuja/ui'
import { MessageCircleQuestion } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { getSellerFromSession } from '@/lib/seller-session'
import { QuestionProductThumb } from './_components/product-thumb'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri Soruları',
}

const FILTERS = [
  { key: 'bekleyen', label: 'Yanıt bekleyen' },
  { key: 'tumu', label: 'Tümü' },
] as const

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  searchParams: Promise<{ durum?: string; sayfa?: string }>
}

function listHref(filter: 'bekleyen' | 'tumu', page = 1) {
  const params = new URLSearchParams()
  if (filter === 'tumu') params.set('durum', 'tumu')
  if (page > 1) params.set('sayfa', String(page))
  const query = params.toString()
  return query ? `/musteri-sorulari?${query}` : '/musteri-sorulari'
}

export default async function CustomerQuestionsPage({ searchParams }: Props) {
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const { durum, sayfa } = await searchParams
  const filter = durum === 'tumu' ? 'tumu' : 'bekleyen'

  const { items: threads, page, totalPages, total } = await createProductQuestionService({
    prisma: createPrismaForRoute(),
  }).listForSeller(seller.id, {
    ...(filter === 'bekleyen' ? { status: 'waiting_for_seller' as const } : {}),
    page: Number.parseInt(sayfa ?? '1', 10) || 1,
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Müşteri Soruları"
        description="Müşterilerin ürünleriniz ve siparişleri hakkında sorduğu sorular. Konuşma herkese açık değildir. Siz, ilgili müşteri ve denetim amacıyla yetkili yöneticiler erişebilir."
      />

      <div className="flex gap-2" role="tablist" aria-label="Soru filtresi">
        {FILTERS.map((item) => {
          const active = item.key === filter
          return (
            <Link
              key={item.key}
              href={listHref(item.key)}
              role="tab"
              aria-selected={active}
              className="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                backgroundColor: active ? 'var(--color-primary)' : 'var(--color-surface)',
                color: active ? 'var(--color-primary-fg, #fff)' : 'var(--color-muted-fg)',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>

      <div
        className="rounded-xl border"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {total === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <MessageCircleQuestion className="h-8 w-8" style={{ color: 'var(--color-muted-fg)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
              {filter === 'bekleyen' ? 'Yanıt bekleyen soru yok' : 'Henüz müşteri sorusu yok'}
            </p>
            <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
              Müşteriler ürün sayfasındaki “Soru Sor” butonuyla size soru sorduğunda burada görünür.
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/musteri-sorulari/${thread.id}`}
                  className="flex gap-4 px-5 py-4 transition-colors hover:bg-[var(--color-muted)]"
                >
                  <QuestionProductThumb imageUrl={thread.productImageUrl} alt={thread.productName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="truncate text-sm font-medium" style={{ color: 'var(--color-primary)' }}>
                        {thread.productName}
                      </p>
                      <time className="shrink-0 text-xs" style={{ color: 'var(--color-muted-fg)' }} dateTime={thread.lastMessageAt}>
                        {formatDate(thread.lastMessageAt)}
                      </time>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                      {thread.counterpartName}
                      {thread.orderNumber ? ` · Sipariş #${thread.orderNumber}` : ' · Satış öncesi soru'}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                      {thread.lastMessagePreview}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {thread.unread ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900">Okunmadı</span>
                      ) : null}
                      <span
                        className="rounded-full border px-2 py-0.5"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                      >
                        {thread.status === 'waiting_for_seller' ? 'Yanıtınız bekleniyor' : 'Yanıtlandı'}
                      </span>
                    </div>
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
            <Link href={listHref(filter, page - 1)} className="rounded-md border px-3 py-1.5 hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              Önceki
            </Link>
          ) : (
            <span />
          )}
          <span style={{ color: 'var(--color-muted-fg)' }}>
            Sayfa {page} / {totalPages} · {total} konuşma
          </span>
          {page < totalPages ? (
            <Link href={listHref(filter, page + 1)} className="rounded-md border px-3 py-1.5 hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
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
