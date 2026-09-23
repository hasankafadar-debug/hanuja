import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementAudienceSchema,
} from '@hanuja/api/domain/announcement-audience'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

// Lengths are enforced on the trimmed text by the service; this only bounds the payload.
const draftSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().max(ANNOUNCEMENT_TITLE_MAX + 50),
  body: z.string().max(ANNOUNCEMENT_BODY_MAX + 200),
  mediaAssetId: z.string().trim().min(1).max(64).nullable(),
  posterAssetId: z.string().trim().min(1).max(64).nullable(),
  audience: announcementAudienceSchema,
})

/** Saves a draft. Sent announcements are edited through /sent-content. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { service } = await requireAnnouncementAdmin()
    const body = draftSchema.parse(await readJsonBody(req))
    const { id } = await params
    return ok(await service.updateDraft(id, body))
  } catch (error) {
    return handleError(error)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { service } = await requireAnnouncementAdmin()
    const { id } = await params
    return ok(await service.deleteDraft(id))
  } catch (error) {
    return handleError(error)
  }
}
