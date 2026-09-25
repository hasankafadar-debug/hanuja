import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { customerCampaignDraftSchema } from '@hanuja/api/domain/customer-campaign'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

type Context = { params: Promise<{ id: string }> }
export async function PATCH(req: NextRequest, { params }: Context) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    return ok(await service.updateDraft(userId, (await params).id, customerCampaignDraftSchema.parse(await readJsonBody(req))))
  } catch (error) { return handleError(error) }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId, service } = await requireCustomerCampaignAdmin()
    const { version } = z.object({ version: z.number().int().positive() }).parse(await readJsonBody(req))
    return ok(await service.deleteDraft(userId, (await params).id, version))
  } catch (error) { return handleError(error) }
}
