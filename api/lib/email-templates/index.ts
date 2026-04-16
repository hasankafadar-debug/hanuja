/**
 * Email template factory functions.
 * Each function returns { subject, html, text } ready for sendEmail().
 *
 * Language: Turkish (primary platform language).
 * All amounts are formatted as Turkish Lira (₺).
 */

export interface EmailTemplate {
  subject: string
  html: string
  text: string
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
              Sorularınız için <a href="mailto:destek@hanuja.com" style="color:#999999;">destek@hanuja.com</a> adresine ulaşabilirsiniz.
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

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Alındı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${params.customerName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${params.orderNumber}</strong> numaralı siparişinizi aldık. Ödemeniz onaylandıktan sonra satıcıya iletilecektir.
    </p>
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
    <p style="text-align:right;font-size:16px;font-weight:bold;color:#1a1a1a;">Toplam: ${params.totalAmount}</p>
  `

  return {
    subject: `Siparişiniz Alındı — #${params.orderNumber}`,
    html: layout('Siparişiniz Alındı', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizi aldık. Toplam: ${params.totalAmount}`,
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

/** Return request confirmation — sent to customer */
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
