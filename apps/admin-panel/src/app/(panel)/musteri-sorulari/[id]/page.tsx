import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@hanuja/ui'
import { getAdminSession } from '@/lib/admin-session'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri Sorusu',
  robots: { index: false, follow: false },
}

const ROLE_LABELS: Record<string, string> = {
  customer: 'Müşteri',
  seller: 'Satıcı',
  admin: 'Admin',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface Props {
  params: Promise<{ id: string }>
}

// Read-only. Every render writes a `product_question_viewed` audit entry.
export default async function AdminProductQuestionDetailPage({ params }: Props) {
  const session = await getAdminSession()
  const { id } = await params
  const ipAddress = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim()

  const thread = await createProductQuestionService({
    prisma: createPrismaForRoute(),
  }).getForAdminWithAudit(id, session.user.id, ipAddress || undefined)
  if (!thread) notFound()

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/musteri-sorulari"
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Müşteri Soruları
      </Link>

      <PageHeader
        title={thread.product.name}
        description="Salt okunur görünüm. Bu görüntüleme denetim günlüğüne kaydedildi."
      />

      <dl
        className="grid gap-4 rounded-xl border p-4 text-sm sm:grid-cols-2"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <div>
          <dt style={{ color: 'var(--color-muted-fg)' }}>Satıcı</dt>
          <dd className="font-medium">
            <Link href={`/saticilar/${thread.sellerId}`} className="hover:underline">
              {thread.seller.displayName}
            </Link>
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--color-muted-fg)' }}>Müşteri</dt>
          <dd className="font-medium">
            {thread.customer.name} <span style={{ color: 'var(--color-muted-fg)' }}>({thread.customer.email})</span>
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--color-muted-fg)' }}>Sipariş</dt>
          <dd className="font-medium">
            {thread.order ? (
              <Link href={`/siparisler/${thread.order.id}`} className="hover:underline">
                #{thread.order.number}
              </Link>
            ) : (
              'Satış öncesi soru'
            )}
          </dd>
        </div>
        <div>
          <dt style={{ color: 'var(--color-muted-fg)' }}>Durum</dt>
          <dd className="font-medium">
            {thread.status === 'waiting_for_seller' ? 'Satıcı yanıtı bekleniyor' : 'Yanıtlandı'}
          </dd>
        </div>
      </dl>

      <ol
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        {thread.messages.map((message) => (
          <li key={message.id} className="space-y-1">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-muted-fg)' }}>
              <span className="font-semibold">{ROLE_LABELS[message.authorRole] ?? message.authorRole}</span>
              <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
            </div>
            <p
              className="whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm"
              style={{ backgroundColor: 'var(--color-muted)', color: 'var(--color-primary)' }}
            >
              {message.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
