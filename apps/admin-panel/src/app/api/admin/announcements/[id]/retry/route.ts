import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

const schema = z.object({
  reason: z.string().trim().min(10).max(500),
  eligibleHash: z.string().regex(/^[a-f0-9]{64}$/),
})

/** Marks the previewed failed recipients; the dispatch sweep requeues them within capacity. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { userId, service } = await requireAnnouncementAdmin()
    const rateLimit = await checkUserRateLimit(userId, 'admin-announcement:retry', SENSITIVE_RATE_LIMIT)
    if (!rateLimit.allowed && rateLimit.response) return rateLimit.response
    const body = schema.parse(await readJsonBody(req))
    const { id } = await params
    return ok(await service.retryFailed(userId, id, body))
  } catch (error) {
    return handleError(error)
  }
}
