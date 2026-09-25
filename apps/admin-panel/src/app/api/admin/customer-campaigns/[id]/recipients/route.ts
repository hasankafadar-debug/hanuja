import { type NextRequest } from 'next/server'
import { handleError, ok } from '@hanuja/api/lib/response'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireCustomerCampaignAdmin()
    return ok(await service.previewRecipients((await params).id, Number(req.nextUrl.searchParams.get('sayfa') ?? 1)))
  } catch (error) { return handleError(error) }
}
