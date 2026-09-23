import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX } from '@hanuja/api/domain/announcement-audience'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

const schema = z.object({
  version: z.number().int().positive(),
  title: z.string().max(ANNOUNCEMENT_TITLE_MAX + 50),
  body: z.string().max(ANNOUNCEMENT_BODY_MAX + 200),
})

/** Edits the panel copy of a sent announcement. Never resends e-mail. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { userId, service } = await requireAnnouncementAdmin()
    const body = schema.parse(await readJsonBody(req))
    const { id } = await params
    return ok(await service.updateAfterSend(userId, id, body))
  } catch (error) {
    return handleError(error)
  }
}
