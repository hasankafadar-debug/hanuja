import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createCustomerCampaignService } from '@hanuja/api/services/customer-campaign.service'
import { getAdminSession } from '@/lib/admin-session'
import { CampaignEditor } from '../_components/campaign-editor'
export const dynamic = 'force-dynamic'
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  await getAdminSession()
  const campaign = await createCustomerCampaignService({ prisma: createPrismaForRoute() }).getForAdmin((await params).id)
  return <CampaignEditor initial={JSON.parse(JSON.stringify(campaign))} />
}
