/**
 * Email template factory functions.
 * Each function returns { subject, html, text } ready for sendEmail().
 *
 * Language: Turkish (primary platform language).
 * All amounts are formatted as Turkish Lira (TL) using formatMoney.
 */

import { PLATFORM_LEGAL_INFO } from '../platform-info'

export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

/**
 * Escape user/seller-controlled values before interpolating into an HTML email
 * body. Prevents markup/script injection through fields like product or store
 * names. Only for the HTML branch — the text branch stays raw.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** True only for absolute http(s) URLs — blocks javascript:/data: hrefs. */
function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

/** Shared wrapper for consistent email layout */
function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="580" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr>
          <td style="background:#1a1a1a;padding:24px 32px;">
            <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:1px;">Hanuja</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eeeeee;">
            <p style="margin:0;font-size:12px;color:#999999;">
              Bu e-posta Hanuja tarafından otomatik olarak gönderilmiştir.
              Sorularınız için <a href="mailto:${PLATFORM_LEGAL_INFO.supportEmail}" style="color:#999999;">${PLATFORM_LEGAL_INFO.supportEmail}</a> adresine ulaşabilirsiniz.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Order confirmation — sent to customer after payment */
export function orderConfirmationTemplate(params: {
  customerName: string
  orderNumber: string
  totalAmount: string
  items: Array<{ name: string; quantity: number; price: string }>
  paymentMethod: 'card' | 'eft'
  bankTransferInstructions?: {
    bankName: string
    accountHolder: string
    iban: string
    reference: string
    missing?: boolean
  }
}): EmailTemplate {
  const itemRows = params.items
    .map(
      (item) =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${item.name}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:center;">${item.quantity}</td>
          <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;">${item.price}</td>
        </tr>`,
    )
    .join('')

  const paymentLabel = params.paymentMethod === 'eft' ? 'Havale / EFT' : 'Kredi Kartı'
  const bankInstructions =
    params.paymentMethod === 'eft'
      ? params.bankTransferInstructions?.missing
        ? `
    <p style="margin:16px 0 0;font-size:14px;color:#555;">
      Banka bilgileri için lütfen destek ekibimizle iletişime geçin.
    </p>
  `
        : `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;margin:16px 0 24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Banka:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.bankTransferInstructions?.bankName ?? '-'}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Hesap Sahibi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.bankTransferInstructions?.accountHolder ?? '-'}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>IBAN:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;"><strong>${params.bankTransferInstructions?.iban ?? '-'}</strong></td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Açıklama / Referans:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.bankTransferInstructions?.reference ?? params.orderNumber}</td>
      </tr>
    </table>
    <p style="margin:0 0 24px;font-size:14px;color:#555;">
      Ödemeniz onaylandıktan sonra siparişiniz hazırlanmaya başlanacaktır.
    </p>
  `
      : ''

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Alındı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı siparişinizi aldık.
    </p>
    <p style="margin:0 0 12px;font-size:14px;color:#555;"><strong>Ödeme Yöntemi:</strong> ${paymentLabel}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <thead>
        <tr>
          <th style="text-align:left;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Ürün</th>
          <th style="text-align:center;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Adet</th>
          <th style="text-align:right;font-size:13px;color:#888;padding-bottom:8px;border-bottom:2px solid #eee;">Fiyat</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    ${bankInstructions}
    <p style="text-align:right;font-size:16px;font-weight:bold;color:#1a1a1a;">Toplam: ${params.totalAmount}</p>
  `

  return {
    subject: `Siparişiniz Alındı — #${params.orderNumber}`,
    html: layout('Siparişiniz Alındı', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizi aldık. Ödeme yöntemi: ${paymentLabel}. Toplam: ${params.totalAmount}${params.paymentMethod === 'eft' ? ` Referans: ${params.bankTransferInstructions?.reference ?? params.orderNumber}.` : ''}`,
  }
}

/** Shipment notification — sent to customer when order is shipped */
export function shipmentNotificationTemplate(params: {
  customerName: string
  orderNumber: string
  trackingNumber: string
  cargoCompany: string
}): EmailTemplate {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Kargoya Verildi</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı siparişiniz kargoya verildi.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Kargo Firması:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.cargoCompany}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Takip Numarası:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;"><strong>${params.trackingNumber}</strong></td>
      </tr>
    </table>
  `

  return {
    subject: `Siparişiniz Yolda — #${params.orderNumber}`,
    html: layout('Siparişiniz Kargoya Verildi', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} siparişiniz kargoya verildi. Takip no: ${params.trackingNumber} (${params.cargoCompany})`,
  }
}

/** Delivery confirmation — sent to customer when delivery is confirmed */
export function deliveryConfirmedTemplate(params: {
  customerName: string
  orderNumber: string
}): EmailTemplate {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Teslim Edildi</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı siparişiniz teslim edildi olarak işaretlendi.
      Ürünlerinizden memnun değilseniz, teslimattan itibaren 14 gün içinde iade talebinde bulunabilirsiniz.
    </p>
  `

  return {
    subject: `Siparişiniz Teslim Edildi — #${params.orderNumber}`,
    html: layout('Siparişiniz Teslim Edildi', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} siparişiniz teslim edildi. 14 gün içinde iade talebinde bulunabilirsiniz.`,
  }
}

/** Invoice uploaded — sent to customer when seller invoice is added */
export function invoiceUploadedTemplate(params: {
  customerName: string
  orderNumber: string
  orderUrl?: string
}): EmailTemplate {
  const cta = params.orderUrl
    ? `
    <p style="margin:0 0 24px;">
      <a
        href="${params.orderUrl}"
        style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;"
      >
        Siparişimi Görüntüle
      </a>
    </p>
  `
    : ''

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Faturanız Hazır</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı siparişiniz için satıcı faturası yüklendi.
      Faturanızı hesabınıza giriş yaparak sipariş detayınızdan görüntüleyebilirsiniz.
    </p>
    ${cta}
  `

  return {
    subject: `Faturanız Hazır — #${params.orderNumber}`,
    html: layout('Faturanız Hazır', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz için satıcı faturası yüklendi. Faturanızı hesabınıza giriş yaparak sipariş detayınızdan görüntüleyebilirsiniz.${params.orderUrl ? ` Sipariş detayı: ${params.orderUrl}` : ''}`,
  }
}

export function returnRequestTemplate(params: {
  customerName: string
  orderNumber: string
  returnReason: string
}): EmailTemplate {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">İade Talebiniz Alındı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı sipariş için iade talebinizi aldık.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>İade Sebebi:</strong></p>
    <p style="margin:0 0 24px;font-size:14px;color:#333;background:#f9f9f9;padding:12px;border-radius:4px;">${params.returnReason}</p>
    <p style="margin:0;font-size:14px;color:#555;">
      Talebiniz incelenecek ve size en kısa sürede geri dönüş yapılacaktır.
    </p>
  `

  return {
    subject: `İade Talebiniz Alındı — #${params.orderNumber}`,
    html: layout('İade Talebiniz Alındı', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} için iade talebinizi aldık. Sebep: ${params.returnReason}`,
  }
}

/** Payout notification — sent to seller when payout is processed */
export function payoutProcessedTemplate(params: {
  sellerName: string
  payoutAmount: string
  payoutDate: string
  periodDescription: string
}): EmailTemplate {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Ödemeniz Gerçekleşti</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.sellerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>${params.periodDescription}</strong> dönemi için satıcı ödemeniz gerçekleştirildi.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Net Ödeme Tutarı:</strong></td>
        <td style="font-size:16px;color:#1a1a1a;font-weight:bold;padding:6px 0;">${params.payoutAmount}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>İşlem Tarihi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.payoutDate}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#555;">
      Detayları satıcı panelinizden görüntüleyebilirsiniz.
    </p>
  `

  return {
    subject: `Ödemeniz Gerçekleşti — ${params.payoutAmount}`,
    html: layout('Ödemeniz Gerçekleşti', body),
    text: `Merhaba ${params.sellerName}, ${params.periodDescription} dönemi ödemesi gerçekleşti. Net tutar: ${params.payoutAmount}. Tarih: ${params.payoutDate}`,
  }
}

/** Penalty notice — sent to seller when penalty is applied */
export function penaltyAppliedTemplate(params: {
  sellerName: string
  orderNumber: string
  penaltyAmount: string
  penaltyReason: string
}): EmailTemplate {
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Ceza Uygulandı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.sellerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı sipariş için hesabınıza ceza uygulandı.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fecaca;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Ceza Tutarı:</strong></td>
        <td style="font-size:16px;color:#dc2626;font-weight:bold;padding:6px 0;">${params.penaltyAmount}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Ceza Sebebi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${params.penaltyReason}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:14px;color:#555;">
      Ceza tutarı bir sonraki ödemenizden mahsup edilecektir. Detaylar için satıcı panelinizi inceleyebilirsiniz.
    </p>
  `

  return {
    subject: `Hesabınıza Ceza Uygulandı — #${params.orderNumber}`,
    html: layout('Ceza Uygulandı', body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} için ${params.penaltyAmount} ceza uygulandı. Sebep: ${params.penaltyReason}`,
  }
}

export function storeDiscountFollowedSellerTemplate(params: {
  customerName: string
  sellerName: string
  storeUrl: string
  unsubscribeUrl: string
}): EmailTemplate {
  // Seller/customer-controlled fields — escape before HTML interpolation.
  const customerNameHtml = escapeHtml(params.customerName)
  const sellerNameHtml = escapeHtml(params.sellerName)

  const storeCta = isSafeHttpUrl(params.storeUrl)
    ? `
      <a
        href="${params.storeUrl}"
        style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;"
      >
        Mağazayı Gör
      </a>`
    : `<span style="display:inline-block;color:#135854;font-size:14px;font-weight:600;">Mağazayı Gör</span>`

  const unsubscribeCta = isSafeHttpUrl(params.unsubscribeUrl)
    ? `<a href="${params.unsubscribeUrl}" style="color:#135854;">buradan çıkış yapabilirsiniz</a>`
    : 'buradan çıkış yapabilirsiniz'

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Takip Ettiğiniz Mağazada İndirim Var</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${customerNameHtml},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>${sellerNameHtml}</strong> mağazasında yeni bir indirim başladı.
      Güncel ürünleri görmek için mağaza sayfasını ziyaret edebilirsiniz.
    </p>
    <p style="margin:0 0 24px;">
      ${storeCta}
    </p>
    <p style="margin:0;font-size:13px;color:#777;">
      Bu mağaza için e-posta almak istemiyorsanız
      ${unsubscribeCta}.
      Desteklenen posta kutularında bu e-postayı <strong>RET</strong> yazarak yanıtlamak da e-posta bildirimlerini kapatır.
    </p>
  `

  return {
    subject: `${params.sellerName} mağazasında indirim başladı`,
    html: layout('Takip Ettiğiniz Mağazada İndirim Var', body),
    text: `Merhaba ${params.customerName}, ${params.sellerName} mağazasında indirim başladı. Mağaza: ${params.storeUrl} Çıkış: ${params.unsubscribeUrl}`,
  }
}

/**
 * Product discount — sent to a customer who favorited or has-in-cart a product
 * that just went on sale. `context` selects the copy variant.
 */
export function productDiscountTemplate(params: {
  customerName: string
  productName: string
  productUrl: string
  sellerName: string
  context: 'favorite' | 'cart'
  unsubscribeUrl: string
}): EmailTemplate {
  const isFavorite = params.context === 'favorite'
  const heading = isFavorite
    ? 'Favorinizdeki Ürün Şimdi İndirimde'
    : 'Sepetinizdeki Ürün Şimdi İndirimde'

  // Seller/customer-controlled fields — escape before HTML interpolation.
  const customerNameHtml = escapeHtml(params.customerName)
  const productNameHtml = escapeHtml(params.productName)
  const sellerNameHtml = escapeHtml(params.sellerName)

  const lead = isFavorite
    ? `Favorilerinize eklediğiniz <strong>${productNameHtml}</strong> ürünü, <strong>${sellerNameHtml}</strong> mağazasında şimdi indirimde.`
    : `Sepetinizdeki <strong>${productNameHtml}</strong> ürünü, <strong>${sellerNameHtml}</strong> mağazasında şimdi indirimde.`

  const productCta = isSafeHttpUrl(params.productUrl)
    ? `
      <a
        href="${params.productUrl}"
        style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;"
      >
        Ürünü İncele
      </a>`
    : `<span style="display:inline-block;color:#135854;font-size:14px;font-weight:600;">Ürünü İncele</span>`

  const unsubscribeCta = isSafeHttpUrl(params.unsubscribeUrl)
    ? `<a href="${params.unsubscribeUrl}" style="color:#135854;">abonelikten çıkın</a>`
    : 'abonelikten çıkın'

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${heading}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${customerNameHtml},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">${lead}</p>
    <p style="margin:0 0 24px;">
      ${productCta}
    </p>
    <p style="margin:0;font-size:13px;color:#777;">
      Kampanya e-postalarını almak istemiyorsanız
      ${unsubscribeCta}.
    </p>
  `

  const textLead = isFavorite
    ? `Favorilerinize eklediğiniz ${params.productName} ürünü, ${params.sellerName} mağazasında şimdi indirimde.`
    : `Sepetinizdeki ${params.productName} ürünü, ${params.sellerName} mağazasında şimdi indirimde.`

  return {
    subject: heading,
    html: layout(heading, body),
    text: `Merhaba ${params.customerName}, ${textLead} Ürünü incele: ${params.productUrl} Abonelikten çıkış: ${params.unsubscribeUrl}`,
  }
}

export { sellerApprovalTemplate } from './seller-approval'
export { sellerPasswordResetTemplate } from './seller-password-reset'
export { sellerDocumentsRequestedTemplate } from './seller-documents-requested'
export { passwordResetTemplate } from './password-reset'
export { passwordChangedTemplate } from './password-changed'
