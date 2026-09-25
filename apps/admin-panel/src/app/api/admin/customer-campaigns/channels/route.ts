import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { readJsonBody } from '@hanuja/api/lib/request-body'
import { handleError, ok } from '@hanuja/api/lib/response'
import { getMarketingChannelStatus, updateMarketingChannel } from '@hanuja/api/services/marketing-channel.service'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function GET() {
  try {
    await requireCustomerCampaignAdmin()
    const prisma = createPrismaForRoute()
    return ok(await Promise.all([getMarketingChannelStatus(prisma, 'email'), getMarketingChannelStatus(prisma, 'sms')]))
  } catch (error) { return handleError(error) }
}

export async function PATCH(req: NextRequest) {
  const csrf = checkCsrf(req)
  if (csrf) return csrf
  try {
    const { userId } = await requireCustomerCampaignAdmin()
    const body = z.object({ channel: z.enum(['email', 'sms']), enabled: z.boolean(), version: z.number().int().nonnegative() }).parse(await readJsonBody(req))
    return ok(await updateMarketingChannel(createPrismaForRoute(), { ...body, actorId: userId }))
  } catch (error) { return handleError(error) }
}
