import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { QuestionProductThumb } from '@/components/product-questions/product-thumb'
import { QuestionThread } from '@/components/product-questions/question-thread'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Soru',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ id: string }>
}

// Server render never marks the conversation read; QuestionThread reports the
// last message shown once the page is visible.
export default async function MyQuestionDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect(`/giris?callbackUrl=${encodeURIComponent(`/hesabim/sorularim/${id}`)}`)

  const thread = await createProductQuestionService({ prisma: createPrismaForRoute() }).getForCustomer(
    id,
    session.user.id,
  )
  if (!thread) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/hesabim/sorularim"
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Sorularım
      </Link>

      <div className="flex items-center gap-4 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)' }}>
        <QuestionProductThumb imageUrl={thread.product.imageUrl} alt={thread.product.name} size={64} />
        <div className="min-w-0 flex-1">
          {thread.product.published ? (
            <Link href={`/urun/${thread.product.slug}`} className="font-medium hover:underline" style={{ color: 'var(--color-primary)' }}>
              {thread.product.name}
            </Link>
          ) : (
            <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
              {thread.product.name}
            </p>
          )}
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            {thread.seller.displayName}
            {thread.order ? (
              <>
                {' · '}
                <Link href={`/siparis/${thread.order.id}`} className="hover:underline">
                  Sipariş #{thread.order.number}
                </Link>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <QuestionThread
        threadId={thread.id}
        sellerName={thread.seller.displayName}
        messages={thread.messages}
        canReply={thread.canReply}
      />
    </div>
  )
}
