import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function GET(req: NextRequest) {
  try {
    const { service } = await requireCustomerCampaignAdmin()
    return ok(await service.searchCustomers(req.nextUrl.searchParams.get('q') ?? ''))
  } catch (error) { return handleError(error) }
}
