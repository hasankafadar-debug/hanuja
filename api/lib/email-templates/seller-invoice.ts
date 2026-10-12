/**
 * Satıcının Hanuja'ya keseceği fatura e-postaları (satıcı Hanuja modeli). Fatura, ürün
 * kargoya verilirken kesilir ve açıklamasında sipariş numarası bulunur. Tutar dökümü
 * yalnız satıcı panelindedir; e-postada para tutarı tekrarlanmaz.
 */

import type { EmailTemplate } from './types'
import { escapeHtml, greeting, heading, isSafeHttpUrl, layout, paragraph, renderCta, renderInfoBox } from './shared'

export interface SellerInvoiceReminderEmailInput {
  sellerName: string
  orderNumber: string
  panelUrl?: string
}

export interface SellerInvoiceRejectedEmailInput extends SellerInvoiceReminderEmailInput {
  reason: string
}

function panelLine(panelUrl: string | undefined) {
  return isSafeHttpUrl(panelUrl) ? `\nTasarımcı paneli: ${panelUrl.trim()}` : ''
}

export function sellerInvoiceReminderTemplate(params: SellerInvoiceReminderEmailInput): EmailTemplate {
  const title = "Hanuja'ya Fatura Bekleniyor"
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişi kargoya verdiniz, ancak bu sipariş için Hanuja'ya kestiğiniz fatura henüz bize ulaşmadı.`)}
    ${paragraph('Fatura tutarını, KDV dökümünü ve Hanuja\'nın fatura bilgilerini tasarımcı panelindeki sipariş detayında bulabilirsiniz. Faturanın açıklama alanına sipariş numarasını yazmayı unutmayın.')}
    ${renderInfoBox([['Hakediş', 'Vade, onaylanan faturanızın tarihinden hesaplanır. Fatura gelmeden hakediş süresi başlamaz.']])}
    ${renderCta('Siparişi Görüntüle', params.panelUrl)}
  `
  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişi kargoya verdiniz ancak bu sipariş için Hanuja'ya kestiğiniz fatura henüz bize ulaşmadı. Fatura tutarı ve Hanuja'nın fatura bilgileri tasarımcı panelindeki sipariş detayındadır; faturanın açıklamasına sipariş numarasını yazın. Fatura gelmeden hakediş süresi başlamaz.${panelLine(params.panelUrl)}`,
  }
}

export function sellerInvoiceRejectedTemplate(params: SellerInvoiceRejectedEmailInput): EmailTemplate {
  const title = 'Faturanız Onaylanmadı'
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı sipariş için Hanuja'ya kestiğiniz fatura kontrolde onaylanmadı.`)}
    ${paragraph('<strong>Gerekçe:</strong>', 'margin:0 0 8px;font-size:14px;color:#555;')}
    ${paragraph(escapeHtml(params.reason.trim()), 'margin:0 0 24px;font-size:14px;color:#333;background:#f9f9f9;padding:12px;border-radius:4px;')}
    ${paragraph('Faturayı düzeltip sipariş detayından yeniden yükleyin. Hakedişiniz düzeltilmiş fatura onaylandıktan sonra hesaplanır.')}
    ${renderCta('Siparişi Görüntüle', params.panelUrl)}
  `
  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı sipariş için Hanuja'ya kestiğiniz fatura onaylanmadı. Gerekçe: ${params.reason.trim()}\nFaturayı düzeltip sipariş detayından yeniden yükleyin.${panelLine(params.panelUrl)}`,
  }
}
