/**
 * Lowest-price-of-15-days e-mail (e-mail plan phase 6). Sent only to customers who favorited
 * the product and gave marketing consent.
 *
 * Wording is deliberately narrow (iş sahibi kararı, 2026-09-24): only the current price and the
 * claim "son 15 günün en düşük fiyatında". No struck-through price, no discount rate, no word
 * "indirim" and no other variants — the 10-day reference price rule for discount
 * advertisements is out of this e-mail's scope.
 */
import type { EmailTemplate } from './types'
import { escapeHtml, greeting, heading, isSafeHttpUrl, layout, paragraph, renderCta } from './shared'
import { marketingFooterHtml, marketingFooterText } from './marketing-footer'

export interface ProductPriceDropEmailInput {
  customerName: string
  productName: string
  variantName?: string
  sellerName?: string
  productUrl: string
  imageUrl?: string
  /** Formatted current price, e.g. "1.249,90 TL". */
  priceText: string
  unsubscribeUrl: string
}

export const PRICE_DROP_SUBJECT = 'Favorilediğiniz ürün son 15 günün en düşük fiyatında'

function productImage(imageUrl: string | undefined, productName: string): string {
  if (!isSafeHttpUrl(imageUrl)) return ''
  return `<p style="margin:0 0 20px;"><img src="${escapeHtml(imageUrl.trim())}" alt="${escapeHtml(productName)}" width="240" style="display:block;width:240px;max-width:100%;height:auto;border-radius:8px;border:1px solid #eee;" /></p>`
}

export function productPriceDropTemplate(params: ProductPriceDropEmailInput): EmailTemplate {
  const label = params.variantName ? `${params.productName} – ${params.variantName}` : params.productName
  const body = `
    ${heading(PRICE_DROP_SUBJECT)}
    ${greeting(params.customerName)}
    ${paragraph(`Favorilediğiniz <strong>${escapeHtml(label)}</strong> son 15 günün en düşük fiyatında.`)}
    ${productImage(params.imageUrl, params.productName)}
    ${paragraph(
      `Güncel fiyat: <strong style="font-size:18px;color:#1a1a1a;">${escapeHtml(params.priceText)}</strong> (KDV dahil)`,
      'margin:0 0 8px;font-size:15px;color:#555;',
    )}
    ${paragraph(
      'Kargo ve kişisel kuponlar bu fiyata dahil değildir. Fiyat ve stok değişebilir.',
      'margin:0 0 24px;font-size:13px;color:#777;',
    )}
    ${renderCta('Ürünü İncele', params.productUrl)}
    <p style="margin:0;font-size:13px;color:#777;">
      Bu e-postayı, ürünü favorilerinize eklediğiniz için alıyorsunuz.
    </p>
    ${marketingFooterHtml(params.unsubscribeUrl)}
  `

  const text = [
    `Merhaba ${params.customerName},`,
    '',
    `Favorilediğiniz ${label} son 15 günün en düşük fiyatında.`,
    `Güncel fiyat: ${params.priceText} (KDV dahil)`,
    'Kargo ve kişisel kuponlar bu fiyata dahil değildir. Fiyat ve stok değişebilir.',
    '',
    `Ürünü incele: ${params.productUrl}`,
    '',
    'Bu e-postayı, ürünü favorilerinize eklediğiniz için alıyorsunuz.',
    marketingFooterText(params.unsubscribeUrl),
  ].join('\n')

  return { subject: PRICE_DROP_SUBJECT, html: layout(PRICE_DROP_SUBJECT, body), text }
}
