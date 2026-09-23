import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EmptyState } from '@hanuja/ui'
import { MessageCircleQuestion } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { QuestionProductThumb } from '@/components/product-questions/product-thumb'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sorularım',
  description: 'Satıcılara sorduğunuz sorular ve yanıtları.',
  robots: { index: false, follow: false },
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function pageHref(page: number) {
  return page <= 1 ? '/hesabim/sorularim' : `/hesabim/sorularim?sayfa=${page}`
}

interface Props {
  searchParams: Promise<{ sayfa?: string }>
}

export default async function MyQuestionsPage({ searchParams }: Props) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/giris?callbackUrl=/hesabim/sorularim')

  const { sayfa } = await searchParams
  const { items: threads, page, totalPages, total } = await createProductQuestionService({
    prisma: createPrismaForRoute(),
  }).listForCustomer(session.user.id, { page: Number.parseInt(sayfa ?? '1', 10) || 1 })

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-primary)' }}>
          Sorularım
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
          Ürünler hakkında satıcılara sorduğunuz sorular. Konuşma herkese açık değildir. Siz, ilgili
          satıcı ve denetim amacıyla yetkili yöneticiler erişebilir.
        </p>
      </div>

      {total === 0 ? (
        <EmptyState
          icon={<MessageCircleQuestion className="h-12 w-12" />}
          title="Henüz soru sormadınız"
          description="Bir ürün sayfasındaki “Soru Sor” butonuyla satıcıya soru sorabilirsiniz."
        />
      ) : (
        <ul className="divide-y rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          {threads.map((thread) => (
            <li key={thread.id}>
              <Link
                href={`/hesabim/sorularim/${thread.id}`}
                className="flex gap-4 p-4 transition-colors hover:bg-[var(--color-muted)]"
              >
                <QuestionProductThumb imageUrl={thread.productImageUrl} alt={thread.productName} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="truncate font-medium" style={{ color: 'var(--color-primary)' }}>
                      {thread.productName}
                    </p>
                    <time className="shrink-0 text-xs" style={{ color: 'var(--color-muted-fg)' }} dateTime={thread.lastMessageAt}>
                      {formatDate(thread.lastMessageAt)}
                    </time>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--color-muted-fg)' }}>
                    {thread.counterpartName}
                    {thread.orderNumber ? ` · Sipariş #${thread.orderNumber}` : ''}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm" style={{ color: 'var(--color-muted-fg)' }}>
                    {thread.lastMessagePreview}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {thread.unread ? (
                      <span className="rounded-full px-2 py-0.5 font-medium text-white" style={{ backgroundColor: 'var(--color-accent)' }}>
                        Yeni yanıt
                      </span>
                    ) : null}
                    <span
                      className="rounded-full border px-2 py-0.5"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted-fg)' }}
                    >
                      {thread.status === 'waiting_for_seller' ? 'Satıcı yanıtı bekleniyor' : 'Yanıtlandı'}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3 text-sm" aria-label="Sayfalar">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="rounded-lg border px-3 py-1.5 hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              Önceki
            </Link>
          ) : (
            <span />
          )}
          <span style={{ color: 'var(--color-muted-fg)' }}>
            Sayfa {page} / {totalPages} · {total} konuşma
          </span>
          {page < totalPages ? (
            <Link href={pageHref(page + 1)} className="rounded-lg border px-3 py-1.5 hover:bg-[var(--color-muted)]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
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
