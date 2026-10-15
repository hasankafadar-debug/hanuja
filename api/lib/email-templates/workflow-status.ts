import type { EmailTemplate } from './types'
import { escapeHtml, heading, layout, paragraph, renderCta } from './shared'

/** Role-specific lifecycle messages; never expose the customer's details to designers. */
export function workflowStatusTemplate(type: string, data: Record<string, unknown>): EmailTemplate {
  const number = String(data.orderNumber ?? '')
  const decision = data.decision === 'approved' ? 'kabul edildi' : 'reddedildi'
  const customerScope = data.partialDecision
    ? 'İade talebinizin incelemeye alınan kısmı'
    : 'İade talebiniz'
  const sellerScope = data.partialDecision ? 'İadenin incelemeye alınan kısmı' : 'İade'
  const entries: Record<string, [string, string]> = {
    customer_return_decision: [
      'Hanuja İade Kararı',
      `${customerScope} Hanuja tarafından ${decision}.${data.decision === 'approved' ? ' Para iadesinin tamamlandığını ayrıca bildireceğiz.' : ' Ayrıntıları siparişinizin iade bölümünde görebilirsiniz.'}`,
    ],
    return_under_review: [
      'İadeniz Hanuja İncelemesinde',
      'İade ürünleriniz Hanuja tarafından değerlendiriliyor. İnceleme sonucunu ayrıca bildireceğiz.',
    ],
    seller_return_shipped: [
      'İade Kargoya Verildi',
      'İade ürünleri kargoya verildi. Ürünler ulaştığında tasarımcı panelinden teslim kararını girin.',
    ],
    seller_return_decision: [
      'Hanuja İade Kararı',
      `${sellerScope} Hanuja tarafından ${decision}. Ayrıntıları tasarımcı panelinde görebilirsiniz.`,
    ],
    seller_refund_completed: [
      'Para İadesi Tamamlandı',
      'Bu siparişle ilgili müşteriye para iadesi tamamlandı. Hesap hareketlerinizi tasarımcı panelinden takip edebilirsiniz.',
    ],
    seller_return_invoice_uploaded: [
      'Hanuja İade Faturası Hazır',
      'Bu iade için Hanuja tarafından düzenlenen faturayı tasarımcı panelinden görüntüleyip indirebilirsiniz.',
    ],
  }
  const entry = entries[type]
  if (!entry) throw new Error('EMAIL_TEMPLATE_UNSUPPORTED')
  const [title, copy] = entry
  const url = String(data.panelUrl ?? data.orderUrl ?? '')
  const tracking =
    type === 'seller_return_shipped'
      ? [String(data.cargoCarrier ?? ''), String(data.trackingNumber ?? '')]
          .filter(Boolean)
          .join(' · ')
      : ''
  const resolution = type === 'customer_return_decision' ? String(data.resolution ?? '') : ''
  return {
    subject: `${title} — #${number}`,
    html: layout(
      title,
      `${heading(title)}${paragraph(`<strong>#${escapeHtml(number)}</strong> · ${escapeHtml(copy)}`)}${tracking ? paragraph(escapeHtml(tracking)) : ''}${resolution ? paragraph(escapeHtml(resolution)) : ''}${renderCta(type === 'return_under_review' || type === 'customer_return_decision' ? 'Siparişimi Görüntüle' : 'Panelde Görüntüle', url)}`,
    ),
    text: `#${number}\n${copy}${tracking ? '\n' + tracking : ''}${resolution ? '\n' + resolution : ''}\n${url}`,
  }
}
