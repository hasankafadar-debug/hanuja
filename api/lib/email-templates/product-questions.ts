/**
 * Product question e-mails (phase 4). Both point to the conversation screen;
 * replies are written in the panel, never by answering the e-mail.
 */

import type {
  CustomerProductQuestionAnsweredEmailInput,
  EmailTemplate,
  SellerProductQuestionEmailInput,
} from './types'
import {
  escapeHtml,
  greeting,
  heading,
  isSafeHttpUrl,
  layout,
  paragraph,
  renderCta,
  renderInfoBox,
} from './shared'

function productRow(productName: string, imageUrl: string | null | undefined): string {
  const image = isSafeHttpUrl(imageUrl)
    ? `<td width="64" style="padding:0 12px 0 0;vertical-align:middle;"><img src="${escapeHtml(imageUrl.trim())}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid #eee;" /></td>`
    : ''
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;"><tbody><tr>${image}<td style="font-size:15px;color:#1a1a1a;font-weight:600;vertical-align:middle;">${escapeHtml(productName)}</td></tr></tbody></table>`
}

/** Message excerpt as a quoted block; escaped, line breaks kept. */
function quote(text: string): string {
  const safe = escapeHtml(text.trim()).replace(/\r?\n/g, '<br />')
  return `<blockquote style="margin:0 0 24px;padding:12px 16px;background:#f6f7f7;border-left:3px solid #135854;font-size:14px;color:#333;line-height:1.5;">${safe}</blockquote>`
}

const PANEL_NOTE =
  'Yanıtınızı bu e-postayı yanıtlayarak değil, bağlantıdaki konuşma ekranından gönderebilirsiniz.'

export function sellerProductQuestionTemplate(params: SellerProductQuestionEmailInput): EmailTemplate {
  const title = 'Müşteri Sorusu'
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph('Bir müşteriniz aşağıdaki ürün hakkında soru sordu.')}
    ${productRow(params.productName, params.productImageUrl)}
    ${renderInfoBox([
      ['Müşteri', params.customerName],
      ['Sipariş', params.orderNumber ? `#${params.orderNumber}` : undefined],
    ])}
    ${quote(params.messageExcerpt)}
    ${renderCta('Soruyu Yanıtla', params.panelUrl)}
    ${paragraph(escapeHtml(PANEL_NOTE), 'margin:0;font-size:13px;color:#777;')}
  `
  const text = [
    `Merhaba ${params.sellerName},`,
    '',
    `Bir müşteriniz "${params.productName}" ürünü hakkında soru sordu.`,
    params.customerName ? `Müşteri: ${params.customerName}` : '',
    params.orderNumber ? `Sipariş: #${params.orderNumber}` : '',
    '',
    params.messageExcerpt.trim(),
    '',
    `Soruyu yanıtla: ${params.panelUrl}`,
    PANEL_NOTE,
  ]
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
  return {
    subject: `${title} — ${params.productName}`,
    html: layout(title, body),
    text,
  }
}

export function customerProductQuestionAnsweredTemplate(
  params: CustomerProductQuestionAnsweredEmailInput,
): EmailTemplate {
  const title = 'Sorunuz yanıtlandı'
  const name = params.customerName?.trim() || 'Değerli Müşterimiz'
  const body = `
    ${heading(title)}
    ${greeting(name)}
    ${paragraph(`<strong>${escapeHtml(params.sellerName)}</strong>, aşağıdaki ürün hakkındaki sorunuzu yanıtladı.`)}
    ${productRow(params.productName, params.productImageUrl)}
    ${params.orderNumber ? renderInfoBox([['Sipariş', `#${params.orderNumber}`]]) : ''}
    ${quote(params.messageExcerpt)}
    ${renderCta('Konuşmayı Görüntüle', params.threadUrl)}
    ${paragraph(escapeHtml(PANEL_NOTE), 'margin:0;font-size:13px;color:#777;')}
  `
  const text = [
    `Merhaba ${name},`,
    '',
    `${params.sellerName}, "${params.productName}" hakkındaki sorunuzu yanıtladı.`,
    params.orderNumber ? `Sipariş: #${params.orderNumber}` : '',
    '',
    params.messageExcerpt.trim(),
    '',
    `Konuşmayı görüntüle: ${params.threadUrl}`,
    PANEL_NOTE,
  ]
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
  return {
    subject: `${title} — ${params.productName}`,
    html: layout(title, body),
    text,
  }
}
