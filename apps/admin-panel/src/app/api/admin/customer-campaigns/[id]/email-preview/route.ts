import { handleError, ok } from '@hanuja/api/lib/response'
import { customerCampaignTemplate } from '@hanuja/api/lib/email-templates/customer-campaign'
import { getWebBaseUrl } from '@hanuja/api/lib/platform-info'
import { requireCustomerCampaignAdmin } from '@/lib/customer-campaign-route'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { service } = await requireCustomerCampaignAdmin()
    const draft = await service.getForAdmin((await params).id)
    if (draft.channel === 'sms') return ok({ html: '', text: draft.body })
    return ok(customerCampaignTemplate({ title: draft.title, body: draft.body, ctaLabel: draft.ctaLabel, ctaUrl: draft.ctaUrl, mediaUrl: draft.media?.url ?? null, mediaKind: draft.media?.kind ?? null, posterUrl: draft.poster?.url ?? null }, `${getWebBaseUrl()}/api/marketing/unsubscribe?token=preview-not-a-real-recipient`))
  } catch (error) { return handleError(error) }
}
