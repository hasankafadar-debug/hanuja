import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { ForbiddenError, UnauthorizedError } from '@hanuja/api/lib/errors'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCustomerCampaignService } from '@hanuja/api/services/customer-campaign.service'

export async function requireCustomerCampaignAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new UnauthorizedError()
  if (session.user.role !== 'admin') throw new ForbiddenError()
  return { userId: session.user.id, service: createCustomerCampaignService({ prisma: createPrismaForRoute() }) }
}
