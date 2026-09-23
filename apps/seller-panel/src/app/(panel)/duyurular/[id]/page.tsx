import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AnnouncementContent } from '@hanuja/ui'
import { NotFoundError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'
import { getSellerFromSession } from '@/lib/seller-session'
import { AnnouncementReadReceipt } from '../_components/announcement-read-receipt'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Duyuru',
}

interface Props {
  params: Promise<{ id: string }>
}

// Only announcements addressed to this seller are readable; rendering does not mark
// them read — the client reports the view once the page is visible.
export default async function AnnouncementDetailPage({ params }: Props) {
  const { id } = await params
  const { seller } = await getSellerFromSession({ allowSuspended: true })
  const announcement = await createAnnouncementService({ prisma: createPrismaForRoute() })
    .getForSeller(seller.id, id)
    .catch((error: unknown) => {
      if (error instanceof NotFoundError) return null
      throw error
    })
  if (!announcement) notFound()

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/duyurular"
        className="inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: 'var(--color-muted-fg)' }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Duyurular
      </Link>

      <div
        className="rounded-xl border p-5"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}
      >
        <AnnouncementContent
          title={announcement.title}
          body={announcement.body}
          sentAt={announcement.sentAt}
          editedAt={announcement.editedAt}
          media={announcement.media}
        />
      </div>

      <AnnouncementReadReceipt announcementId={announcement.id} unread={announcement.unread} />
    </div>
  )
}
