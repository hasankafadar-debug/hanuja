/**
 * Seller announcement e-mail (phase 5). An admin-written operational announcement:
 * the text is shown in full, the image (or a video's poster) is a linked cover and
 * the button opens the announcement in the seller panel, where a video plays.
 * Not marketing mail: no unsubscribe link, the sender is the noreply address.
 */

import type { EmailTemplate, SellerAnnouncementEmailInput } from './types'
import { escapeHtml, greeting, heading, isSafeHttpUrl, layout, paragraph, renderCta } from './shared'

const SUBJECT_PREFIX = 'Hanuja Duyurusu: '
const SUBJECT_MAX_LENGTH = 120
const FOOTNOTE = 'Bu e-posta, Hanuja satıcı hesabınıza gönderilen operasyonel bir duyurudur.'

function subjectFor(title: string): string {
  const subject = `${SUBJECT_PREFIX}${title}`
  return subject.length > SUBJECT_MAX_LENGTH ? `${subject.slice(0, SUBJECT_MAX_LENGTH - 1)}…` : subject
}

/** Plain-text body as paragraphs: blank lines split paragraphs, single line breaks are kept. */
function bodyParagraphs(body: string): string {
  return body
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) =>
      paragraph(
        escapeHtml(block).replace(/\r?\n/g, '<br />'),
        'margin:0 0 16px;font-size:15px;color:#333;line-height:1.6;',
      ),
    )
    .join('')
}

function coverImage(imageUrl: string | null | undefined, panelUrl: string, alt: string): string {
  if (!isSafeHttpUrl(imageUrl)) return ''
  const img = `<img src="${escapeHtml(imageUrl.trim())}" alt="${escapeHtml(alt)}" width="516" style="display:block;width:100%;max-width:516px;height:auto;border:0;border-radius:6px;" />`
  const linked = isSafeHttpUrl(panelUrl)
    ? `<a href="${escapeHtml(panelUrl.trim())}" style="display:block;text-decoration:none;">${img}</a>`
    : img
  return `<div style="margin:0 0 24px;">${linked}</div>`
}

export function sellerAnnouncementTemplate(params: SellerAnnouncementEmailInput): EmailTemplate {
  const title = params.title.trim()
  const ctaLabel = params.isVideo ? 'Videoyu İzle' : 'Duyuruyu Görüntüle'
  const html = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${coverImage(params.coverImageUrl, params.panelUrl, title)}
    ${bodyParagraphs(params.body)}
    ${renderCta(ctaLabel, params.panelUrl)}
    ${paragraph(escapeHtml(FOOTNOTE), 'margin:0;font-size:13px;color:#777;')}
  `
  const text = [
    `Merhaba ${params.sellerName},`,
    '',
    title,
    '',
    params.body.trim(),
    '',
    `${params.isVideo ? 'Videoyu izle' : 'Duyuruyu görüntüle'}: ${params.panelUrl}`,
    '',
    FOOTNOTE,
  ].join('\n')
  return {
    subject: subjectFor(title),
    html: layout(title, html),
    text,
  }
}
