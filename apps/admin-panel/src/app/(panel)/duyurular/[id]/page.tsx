import { notFound } from 'next/navigation'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createAnnouncementService } from '@hanuja/api/services/announcement.service'
import { NotFoundError } from '@hanuja/api/lib/errors'
import { getAdminSession } from '@/lib/admin-session'
import { DraftEditor } from './_components/draft-editor'
import { SentView } from './_components/sent-view'
import type { AnnouncementDraftInitial, AnnouncementSentInitial, FilterOptionsData } from '../_components/types'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Duyuru', robots: { index: false, follow: false } }

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await getAdminSession()
  const { id } = await params
  const service = createAnnouncementService({ prisma: createPrismaForRoute() })

  let data: Awaited<ReturnType<typeof service.getForAdmin>>
  try {
    data = await service.getForAdmin(id)
  } catch (error) {
    if (error instanceof NotFoundError) notFound()
    throw error
  }

  if (data.status === 'sent') {
    const sentInitial: AnnouncementSentInitial = {
      id: data.id,
      status: 'sent',
      version: data.version,
      title: data.title,
      body: data.body,
      sentTitle: data.sentTitle,
      sentBody: data.sentBody,
      sentAt: data.sentAt ? data.sentAt.toISOString() : null,
      editedAfterSendAt: data.editedAfterSendAt ? data.editedAfterSendAt.toISOString() : null,
      recipientCount: data.recipientCount,
      displayMedia: data.displayMedia,
      createdAt: data.createdAt.toISOString(),
    }
    return <SentView initial={sentInitial} />
  }

  const filterOptions = await service.getFilterOptions()

  const draftInitial: AnnouncementDraftInitial = {
    id: data.id,
    status: 'draft',
    version: data.version,
    title: data.title,
    body: data.body,
    audience: data.audience,
    audienceInvalid: data.audienceInvalid,
    manualSellers: data.manualSellers,
    media: data.media,
    poster: data.poster,
    displayMedia: data.displayMedia,
    panelUrl: data.panelUrl,
  }

  return <DraftEditor initial={draftInitial} filterOptions={filterOptions as FilterOptionsData} />
}
