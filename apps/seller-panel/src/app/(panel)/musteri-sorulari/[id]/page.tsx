import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createProductQuestionService } from '@hanuja/api/services/product-question.service'
import { getSellerFromSession } from '@/lib/seller-session'
import { QuestionProductThumb } from '../_components/product-thumb'
import { SellerQuestionThread } from '../_components/seller-question-thread'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Müşteri Sorusu',
}

interface Props {
  params: Promise<{ id: string }>
}

// Rendering does not mark the thread read; the client reports the last message shown.
export default async function CustomerQuestionDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const thread = await createProductQuestionService({ prisma: createPrismaForRoute() }).getForSeller(
    id,
    seller.id,
  )
  if (!thread) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/musteri-sorulari"
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Müşteri Soruları
      </Link>

      <div
        className="flex items-center gap-4 rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <QuestionProductThumb imageUrl={thread.product.imageUrl} alt={thread.product.name} size={64} />
        <div className="min-w-0 flex-1">
          <p className="font-medium" style={{ color: 'var(--color-primary)' }}>
            {thread.product.name}
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted-fg)' }}>
            Müşteri: {thread.customerName}
            {thread.order ? (
              <>
                {' · '}
                <Link href={`/siparisler/${thread.order.id}`} className="hover:underline">
                  Sipariş #{thread.order.number}
                </Link>
              </>
            ) : (
              ' · Satış öncesi soru'
            )}
          </p>
        </div>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <SellerQuestionThread threadId={thread.id} customerName={thread.customerName} messages={thread.messages} />
      </div>
    </div>
  )
}
