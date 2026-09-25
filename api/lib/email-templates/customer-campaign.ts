import { escapeHtml, isSafeHttpUrl, layout, renderCta } from './shared'
import { marketingFooterHtml, marketingFooterText } from './marketing-footer'
import { normalizeCampaignCtaUrl } from '../../domain/customer-campaign'

export function customerCampaignTemplate(content: {
  title: string; body: string; ctaLabel?: string | null; ctaUrl?: string | null;
  mediaUrl?: string | null; mediaKind?: string | null; posterUrl?: string | null;
}, unsubscribeUrl: string) {
  const cover = content.mediaKind === 'video' ? content.posterUrl : content.mediaUrl
  const cta = normalizeCampaignCtaUrl(content.ctaUrl ?? null)
  const image = isSafeHttpUrl(cover) ? `<img src="${escapeHtml(cover)}" alt="" style="width:100%;max-width:560px;height:auto;" />` : ''
  return {
    subject: content.title,
    html: layout(content.title, `${image}<p style="white-space:pre-wrap;line-height:1.7">${escapeHtml(content.body)}</p>${cta ? renderCta(content.ctaLabel || 'İncele', cta) : ''}${marketingFooterHtml(unsubscribeUrl)}`),
    text: [content.title, content.body, cta ? `${content.ctaLabel || 'İncele'}: ${cta}` : '', marketingFooterText(unsubscribeUrl)].filter(Boolean).join('\n\n'),
  }
}
