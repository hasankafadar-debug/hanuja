import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { created, handleError } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    const { version } = z.object({ version: z.number().int().positive() }).parse(await readJsonBody(req))
    return created(await service.copyCampaign(userId, (await params).id, version))
  } catch (error) { return handleError(error) }
}
