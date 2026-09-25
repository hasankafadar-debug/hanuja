import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    const limit = await checkUserRateLimit(userId, 'admin-customer-campaign:retry', SENSITIVE_RATE_LIMIT)
    if (!limit.allowed && limit.response) return limit.response
    const { version } = z.object({ version: z.number().int().positive() }).parse(await readJsonBody(req))
    return ok(await service.retryFailed(userId, (await params).id, version))
  } catch (error) { return handleError(error) }
}
