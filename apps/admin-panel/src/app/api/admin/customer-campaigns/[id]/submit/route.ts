import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { checkUserRateLimit, SENSITIVE_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    const limit = await checkUserRateLimit(userId, 'admin-customer-campaign:submit', SENSITIVE_RATE_LIMIT)
    if (!limit.allowed && limit.response) return limit.response
    const input = z.object({ version: z.number().int().positive(), audienceHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await readJsonBody(req))
    return ok(await service.submit(userId, (await params).id, input))
  } catch (error) { return handleError(error) }
}
