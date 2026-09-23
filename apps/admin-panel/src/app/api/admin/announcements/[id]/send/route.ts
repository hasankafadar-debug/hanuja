import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireAnnouncementAdmin } from '@/lib/announcement-route'

const schema = z.object({
  version: z.number().int().positive(),
  audienceHash: z.string().regex(/^[a-f0-9]{64}$/),
})

/** Freezes the previewed content and recipient list. The worker sends the e-mails. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  try {
    const { userId, service } = await requireAnnouncementAdmin()
    const rateLimit = await checkUserRateLimit(userId, 'admin-announcement:send', SENSITIVE_RATE_LIMIT)
    if (!rateLimit.allowed && rateLimit.response) return rateLimit.response
    const body = schema.parse(await readJsonBody(req))
    const { id } = await params
    return ok(await service.send(userId, id, body))
  } catch (error) {
    return handleError(error)
  }
}
