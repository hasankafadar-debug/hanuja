import { type NextRequest } from 'next/server'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { created, handleError } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

/** Creates an empty draft; the editor fills it in with PATCH. */
export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { userId, service } = await requireAnnouncementAdmin()
    return created(await service.createDraft(userId))
  } catch (error) {
    return handleError(error)
  }
}
