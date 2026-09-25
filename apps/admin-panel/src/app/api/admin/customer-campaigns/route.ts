import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { created, handleError } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    const { channel } = z.object({ channel: z.enum(['email', 'sms']) }).parse(await readJsonBody(req))
    return created(await service.createDraft(userId, channel))
  } catch (error) { return handleError(error) }
}
