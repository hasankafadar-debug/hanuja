/**
 * Email template factory functions.
 * Each function returns { subject, html, text } ready for sendEmail().
 *
 * Language: Turkish (primary platform language).
 * All amounts are formatted as Turkish Lira (TL) using formatMoney.
 */

import { DEFAULT_WEB_URL, PLATFORM_LEGAL_INFO } from '../platform-info'
import type {
  CustomerOrderEmailInput,
  CustomerPaymentConfirmedEmailInput,
  CustomerRefundCompletedEmailInput,
  CustomerReturnRequestEmailInput,
  CustomerShipmentEmailInput,
  EmailAmount,
  FlexibleEmailOrderLine,
  EmailOrderLineInput,
  EmailTemplate,
  SellerCancellationEmailInput,
  SellerOrderEmailInput,
  SellerRefundCompletedEmailInput,
  SellerReturnRequestEmailInput,
} from './types'

export type {
  CustomerOrderEmailInput,
  CustomerPaymentConfirmedEmailInput,
  CustomerRefundCompletedEmailInput,
  CustomerReturnRequestEmailInput,
  CustomerShipmentEmailInput,
  EmailAmount,
  FlexibleEmailOrderLine,
  EmailOrderLine,
  EmailOrderLineInput,
  EmailTemplate,
  LegacyEmailOrderLine,
  SellerCancellationEmailInput,
  SellerOrderEmailInput,
  SellerRefundCompletedEmailInput,
  SellerReturnRequestEmailInput,
} from './types'

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
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function amountText(value: EmailAmount | null | undefined, fallback = '-'): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fallback
    return `${value.toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} TL`
  }
  const text = value.trim()
  return text || fallback
}

function normalizeLineItem(item: EmailOrderLineInput) {
  const productName =
    ('productName' in item ? item.productName : undefined) ??
    ('product' in item ? item.product : undefined) ??
    ('name' in item ? item.name : undefined) ??
    'Ürün'
  const variantName =
    ('variantName' in item ? item.variantName : undefined) ??
    ('variant' in item ? item.variant : undefined) ??
    null
  const unitPrice =
    ('unitPrice' in item ? item.unitPrice : undefined) ??
    ('unitPurchasePrice' in item ? item.unitPurchasePrice : undefined) ??
    ('price' in item ? item.price : undefined)
  return {
    productName,
    sellerId: 'sellerId' in item ? item.sellerId : undefined,
    variantName,
    quantity: item.quantity,
    unitPrice,
    lineTotal: ('lineTotal' in item ? item.lineTotal : undefined) ?? unitPrice,
  }
}

function renderLineItems(items: readonly EmailOrderLineInput[]): string {
  return items
    .map((item) => {
      const line = normalizeLineItem(item)
      const productNameHtml = escapeHtml(line.productName)
      const variantNameHtml = line.variantName ? escapeHtml(line.variantName) : ''
      const productHtml = variantNameHtml
        ? `<span>${productNameHtml}</span><br /><small style="color:#777;font-size:12px;">Varyant: ${variantNameHtml}</small>`
        : productNameHtml

      return `<tr>
        <td style="padding:10px 6px 10px 0;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;vertical-align:top;word-break:break-word;">${productHtml}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:center;vertical-align:top;">${line.quantity}</td>
        <td style="padding:10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:right;vertical-align:top;word-break:break-word;">${escapeHtml(amountText(line.unitPrice))}</td>
        <td style="padding:10px 0 10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;text-align:right;vertical-align:top;word-break:break-word;">${escapeHtml(amountText(line.lineTotal))}</td>
      </tr>`
    })
    .join('')
}

function renderLineItemsText(items: readonly EmailOrderLineInput[]): string {
  return items
    .map((item) => {
      const line = normalizeLineItem(item)
      const variant = line.variantName ? ` / ${line.variantName}` : ''
      return `${line.productName}${variant} — Adet: ${line.quantity}, Birim Satın Alma Fiyatı: ${amountText(line.unitPrice)}, Satır Toplamı: ${amountText(line.lineTotal)}`
    })
    .join('\n')
}

function renderCta(label: string, url: string | undefined): string {
  if (!url || !isSafeHttpUrl(url)) return ''
  return `<p style="margin:0 0 24px;">
    <a href="${escapeHtml(url.trim())}" style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`
}

function renderTotal(totalAmount: EmailAmount | undefined): string {
  return totalAmount === undefined
    ? ''
    : `<p style="margin:20px 0 0;text-align:right;font-size:15px;font-weight:bold;color:#1a1a1a;">Toplam: ${escapeHtml(amountText(totalAmount))}</p>`
}

/** Shared, table-based wrapper for consistent and mobile-friendly emails. */
function layout(title: string, body: string): string {
  const safeTitle = escapeHtml(title)
  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-outer { padding: 12px 0 !important; }
      .email-shell { width: 100% !important; border-radius: 0 !important; }
      .email-header, .email-content, .email-footer { padding-left: 20px !important; padding-right: 20px !important; }
      .email-content { padding-top: 24px !important; padding-bottom: 24px !important; }
      .email-items { font-size: 12px !important; }
      .email-items th, .email-items td { font-size: 12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 12px;">
    <tr><td align="center">
      <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:580px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr>
          <td class="email-header" style="background:#1a1a1a;padding:22px 32px;">
            <a href="${DEFAULT_WEB_URL}" aria-label="Hanuja" style="display:inline-flex;align-items:center;color:#e8e2d4;text-decoration:none;font-size:20px;font-weight:500;letter-spacing:4px;line-height:1;">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 44 44" fill="none" aria-hidden="true" style="display:block;margin-right:12px;">
                <rect x="2" y="2" width="22" height="14" fill="#e8e2d4" opacity=".92" />
                <rect x="28" y="2" width="14" height="14" fill="none" stroke="#e8e2d4" stroke-width="1.4" />
                <rect x="2" y="22" width="14" height="5" fill="#c8b89a" />
                <rect x="20" y="20" width="22" height="22" fill="none" stroke="#e8e2d4" stroke-width="1.4" />
                <rect x="2" y="32" width="8" height="10" fill="#e8e2d4" opacity=".35" />
              </svg>
              <span>HANUJA</span>
            </a>
          </td>
        </tr>
        <tr>
          <td class="email-content" style="padding:32px;">
            ${body}
          </td>
        </tr>
        <tr>
          <td class="email-footer" style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eeeeee;">
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

/** Order-created confirmation — sent to the customer after an order is saved. */
export function orderConfirmationTemplate(
  params: CustomerOrderEmailInput & {
    totalAmount: EmailAmount
    paymentMethod: 'card' | 'eft'
    bankTransferInstructions?: {
      bankName: string
      accountHolder: string
      iban: string
      reference: string
      missing?: boolean
    }
  },
): EmailTemplate {
  const orderUrl = customerOrderUrl(params)
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
        <td style="font-size:14px;color:#333;padding:6px 0;">${escapeHtml(params.bankTransferInstructions?.bankName ?? '-')}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Hesap Sahibi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${escapeHtml(params.bankTransferInstructions?.accountHolder ?? '-')}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>IBAN:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;"><strong>${escapeHtml(params.bankTransferInstructions?.iban ?? '-')}</strong></td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Açıklama / Referans:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${escapeHtml(params.bankTransferInstructions?.reference ?? params.orderNumber)}</td>
      </tr>
    </table>
    <p style="margin:0 0 24px;font-size:14px;color:#555;">
      Ödemeniz onaylandıktan sonra siparişiniz hazırlanmaya başlanacaktır.
    </p>
  `
      : ''

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Alındı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizi aldık.
    </p>
    <p style="margin:0 0 12px;font-size:14px;color:#555;"><strong>Ödeme Yöntemi:</strong> ${paymentLabel}</p>
    <table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;">
      <thead>
        <tr>
          <th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th>
          <th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th>
          <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th>
          <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th>
        </tr>
      </thead>
      <tbody>${renderLineItems(params.items)}</tbody>
    </table>
    ${bankInstructions}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `Siparişiniz Alındı — #${params.orderNumber}`,
    html: layout('Siparişiniz Alındı', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizi aldık.\n${renderLineItemsText(params.items)}\nÖdeme yöntemi: ${paymentLabel}. Toplam: ${amountText(params.totalAmount)}${orderUrl ? ` Sipariş detayı: ${orderUrl}` : ''}${params.paymentMethod === 'eft' ? ` Referans: ${params.bankTransferInstructions?.reference ?? params.orderNumber}.` : ''}`,
  }
}

/**
 * Canonical customer order-created template. The existing
 * orderConfirmationTemplate remains available for callers that also need the
 * EFT instructions; this compact variant is the event-only form.
 */
export function orderCreatedTemplate(params: CustomerOrderEmailInput): EmailTemplate {
  const title = 'Siparişiniz Oluşturuldu'
  const orderUrl = customerOrderUrl(params)
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz oluşturuldu.
    </p>
    <table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;">
      <thead><tr>
        <th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th>
        <th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th>
        <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th>
        <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th>
      </tr></thead>
      <tbody>${renderLineItems(params.items)}</tbody>
    </table>
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz oluşturuldu.\n${renderLineItemsText(params.items)}${params.totalAmount === undefined ? '' : `\nToplam: ${amountText(params.totalAmount)}`}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** Customer event sent when the payment for an order is confirmed. */
export function orderPaymentConfirmedTemplate(
  params: CustomerPaymentConfirmedEmailInput,
): EmailTemplate {
  const title = 'Ödemeniz Onaylandı'
  const orderUrl = customerOrderUrl(params)
  const paymentLabel =
    params.paymentMethod === 'eft'
      ? 'Havale / EFT'
      : params.paymentMethod === 'card'
        ? 'Kredi Kartı'
        : ''
  const paymentCopy = paymentLabel ? ` (${paymentLabel})` : ''
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizin ödemesi onaylandı${paymentCopy}.
      Siparişiniz hazırlık sürecine alındı.
    </p>
    <table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;">
      <thead><tr>
        <th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th>
        <th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th>
        <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th>
        <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th>
      </tr></thead>
      <tbody>${renderLineItems(params.items)}</tbody>
    </table>
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizin ödemesi onaylandı${paymentCopy}. Siparişiniz hazırlık sürecine alındı.\n${renderLineItemsText(params.items)}${params.totalAmount === undefined ? '' : `\nToplam: ${amountText(params.totalAmount)}`}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

// Descriptive aliases keep event terminology available to callers without
// changing the original public template names.
export const orderCreatedEmailTemplate = orderCreatedTemplate
export const orderPaymentConfirmedEmailTemplate = orderPaymentConfirmedTemplate
export const customerOrderCreatedTemplate = orderCreatedTemplate
export const customerPaymentConfirmedTemplate = orderPaymentConfirmedTemplate
export const paymentConfirmedTemplate = orderPaymentConfirmedTemplate

/** Shipment notification — sent to customer when order is shipped */
export function shipmentNotificationTemplate(params: CustomerShipmentEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const trackingCopy = params.trackingNumber
    ? `<strong>${escapeHtml(params.trackingNumber)}</strong>`
    : 'Henüz paylaşılmadı'
  const cargoCopy = params.cargoCompany ? escapeHtml(params.cargoCompany) : 'Belirtilmedi'
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Siparişiniz Kargoya Verildi</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 16px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz kargoya verildi.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Kargo Firması:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${cargoCopy}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Takip Numarası:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${trackingCopy}</td>
      </tr>
    </table>
    ${items.length ? `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;"><thead><tr><th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th><th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th></tr></thead><tbody>${renderLineItems(items)}</tbody></table>` : ''}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `Siparişiniz Yolda — #${params.orderNumber}`,
    html: layout('Siparişiniz Kargoya Verildi', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} siparişiniz kargoya verildi. Takip no: ${params.trackingNumber ?? 'Henüz paylaşılmadı'} (${params.cargoCompany ?? 'Belirtilmedi'}).${items.length ? `\n${renderLineItemsText(items)}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

export const orderShippedTemplate = shipmentNotificationTemplate
export const orderShippedEmailTemplate = shipmentNotificationTemplate
export const customerOrderShippedTemplate = shipmentNotificationTemplate

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
  const cta = renderCta('Siparişimi Görüntüle', params.orderUrl)

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">Faturanız Hazır</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için satıcı faturası yüklendi.
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

export function returnRequestTemplate(params: CustomerReturnRequestEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const returnReason = params.returnReason?.trim() || 'Belirtilmedi'
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">İade Talebiniz Alındı</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı sipariş için iade talebinizi aldık.
    </p>
    <p style="margin:0 0 8px;font-size:14px;color:#555;"><strong>İade Sebebi:</strong></p>
    <p style="margin:0 0 24px;font-size:14px;color:#333;background:#f9f9f9;padding:12px;border-radius:4px;">${escapeHtml(returnReason)}</p>
    <p style="margin:0;font-size:14px;color:#555;">
      Talebiniz incelenecek ve size en kısa sürede geri dönüş yapılacaktır.
    </p>
    ${items.length ? `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-top:24px;"><thead><tr><th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th><th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th></tr></thead><tbody>${renderLineItems(items)}</tbody></table>` : ''}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `İade Talebiniz Alındı — #${params.orderNumber}`,
    html: layout('İade Talebiniz Alındı', body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} için iade talebinizi aldık. Sebep: ${returnReason}${items.length ? `\n${renderLineItemsText(items)}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** Customer event emitted once the return refund is finalised. */
export function refundCompletedTemplate(params: CustomerRefundCompletedEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const refundAmount =
    params.refundAmount === undefined ? '' : ` ${amountText(params.refundAmount)} tutarındaki`
  const title = 'İadeniz Tamamlandı'
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.customerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için${refundAmount} iade kesinleşti ve ödeme iade sürecine alındı.
    </p>
    ${items.length ? `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;"><thead><tr><th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th><th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th><th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th></tr></thead><tbody>${renderLineItems(items)}</tbody></table>` : ''}
    ${params.refundAmount === undefined ? '' : `<p style="margin:0 0 24px;text-align:right;font-size:15px;font-weight:bold;color:#1a1a1a;">İade Tutarı: ${escapeHtml(amountText(params.refundAmount))}</p>`}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz için${refundAmount} iade kesinleşti ve ödeme iade sürecine alındı.${params.refundAmount === undefined ? '' : ` İade tutarı: ${amountText(params.refundAmount)}.`}${items.length ? `\n${renderLineItemsText(items)}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

function customerOrderUrl(
  params: Pick<CustomerOrderEmailInput, 'orderUrl' | 'customerOrderUrl' | 'orderLink'>,
): string | undefined {
  return params.orderUrl ?? params.customerOrderUrl ?? params.orderLink
}

function sellerOrderUrl(params: SellerOrderEmailInput): string | undefined {
  return params.panelUrl ?? params.sellerPanelUrl ?? params.panelLink ?? params.orderUrl
}

/**
 * Seller payloads should normally already contain seller-owned lines. When a
 * caller also supplies sellerId and line ownership metadata, keep the final
 * boundary in the renderer so another seller's product cannot leak into the
 * e-mail by accident.
 */
function sellerScopedItems(params: SellerOrderEmailInput): readonly EmailOrderLineInput[] {
  if (!params.sellerId) return params.items
  const linesWithOwnership = params.items.filter((item) => 'sellerId' in item && item.sellerId)
  if (linesWithOwnership.length === 0) return params.items
  return linesWithOwnership.filter((item) => item.sellerId === params.sellerId)
}

function sellerItemsTable(
  items: readonly EmailOrderLineInput[],
  margin = 'margin-bottom:24px;',
): string {
  return `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;${margin}">
    <thead><tr>
      <th width="40%" style="width:40%;text-align:left;font-size:12px;color:#888;padding:0 6px 8px 0;border-bottom:2px solid #eee;">Ürün / Varyant</th>
      <th width="12%" style="width:12%;text-align:center;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Adet</th>
      <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;">Birim Satın Alma Fiyatı</th>
      <th width="24%" style="width:24%;text-align:right;font-size:12px;color:#888;padding:0 0 8px 4px;border-bottom:2px solid #eee;">Satır Toplamı</th>
    </tr></thead>
    <tbody>${renderLineItems(items)}</tbody>
  </table>`
}

/** Seller event sent after the order payment is confirmed. */
export function sellerNewOrderTemplate(params: SellerOrderEmailInput): EmailTemplate {
  const title = 'Yeni Sipariş — Ödemesi Onaylandı'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.sellerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişte ödemeniz onaylanmış yeni kalemleriniz var.
    </p>
    ${sellerItemsTable(items)}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Satıcı Panelinde Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişte ödemeniz onaylanmış yeni kalemleriniz var.\n${renderLineItemsText(items)}${params.totalAmount === undefined ? '' : `\nToplam: ${amountText(params.totalAmount)}`}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

/** Seller event for a product/quantity cancellation. */
export function sellerOrderCancellationTemplate(
  params: SellerCancellationEmailInput,
): EmailTemplate {
  const title = 'Ürün / Adet İptali'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const reason = params.cancellationReason?.trim()
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.sellerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişte ürün/adet iptali gerçekleşti.
    </p>
    ${sellerItemsTable(items)}
    ${reason ? `<p style="margin:0 0 24px;font-size:14px;color:#555;"><strong>İptal Nedeni:</strong> ${escapeHtml(reason)}</p>` : ''}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Satıcı Panelinde Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişte ürün/adet iptali gerçekleşti.\n${renderLineItemsText(items)}${reason ? `\nİptal nedeni: ${reason}` : ''}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

/** Seller event for a newly opened return request. */
export function sellerReturnRequestTemplate(params: SellerReturnRequestEmailInput): EmailTemplate {
  const title = 'Yeni İade Talebi'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const reason = params.returnReason?.trim()
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.sellerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı sipariş için iade talebi oluşturuldu.
    </p>
    ${sellerItemsTable(items)}
    ${reason ? `<p style="margin:0 0 24px;font-size:14px;color:#555;"><strong>İade Nedeni:</strong> ${escapeHtml(reason)}</p>` : ''}
    <p style="margin:0 0 24px;font-size:14px;color:#555;">Talebi satıcı panelinden inceleyip gerekli işlemi başlatabilirsiniz.</p>
    ${renderCta('İade Talebini İncele', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı sipariş için iade talebi oluşturuldu.\n${renderLineItemsText(items)}${reason ? `\nİade nedeni: ${reason}` : ''}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

/** Seller event emitted when the return/refund reaches its terminal state. */
export function sellerRefundCompletedTemplate(
  params: SellerRefundCompletedEmailInput,
): EmailTemplate {
  const title = 'İade Tamamlandı'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const refundText =
    params.refundAmount === undefined ? '' : ` ${amountText(params.refundAmount)} tutarındaki`
  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(params.sellerName)},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">
      <strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişte${refundText} iade kesinleşti.
    </p>
    ${sellerItemsTable(items)}
    ${params.refundAmount === undefined ? '' : `<p style="margin:0 0 24px;text-align:right;font-size:15px;font-weight:bold;color:#1a1a1a;">İade Tutarı: ${escapeHtml(amountText(params.refundAmount))}</p>`}
    ${renderCta('Satıcı Panelinde Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişte${refundText} iade kesinleşti.${params.refundAmount === undefined ? '' : ` İade tutarı: ${amountText(params.refundAmount)}.`}\n${renderLineItemsText(items)}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

export const sellerNewOrderEmailTemplate = sellerNewOrderTemplate
export const sellerOrderReceivedTemplate = sellerNewOrderTemplate
export const sellerProductCancellationTemplate = sellerOrderCancellationTemplate
export const sellerQuantityCancellationTemplate = sellerOrderCancellationTemplate
export const sellerReturnRequestedTemplate = sellerReturnRequestTemplate
export const sellerReturnCompletedTemplate = sellerRefundCompletedTemplate
export const sellerRefundCompletedEmailTemplate = sellerRefundCompletedTemplate
export const sellerOrderPaymentConfirmedTemplate = sellerNewOrderTemplate
export const productQuantityCancellationTemplate = sellerOrderCancellationTemplate
export const returnCompletedTemplate = refundCompletedTemplate
export const sellerOrderCancelledTemplate = sellerOrderCancellationTemplate
export const sellerProductCancelledTemplate = sellerOrderCancellationTemplate

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
        href="${escapeHtml(params.storeUrl.trim())}"
        style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;"
      >
        Mağazayı Gör
      </a>`
    : `<span style="display:inline-block;color:#135854;font-size:14px;font-weight:600;">Mağazayı Gör</span>`

  const unsubscribeCta = isSafeHttpUrl(params.unsubscribeUrl)
    ? `<a href="${escapeHtml(params.unsubscribeUrl.trim())}" style="color:#135854;">buradan çıkış yapabilirsiniz</a>`
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
        href="${escapeHtml(params.productUrl.trim())}"
        style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;"
      >
        Ürünü İncele
      </a>`
    : `<span style="display:inline-block;color:#135854;font-size:14px;font-weight:600;">Ürünü İncele</span>`

  const unsubscribeCta = isSafeHttpUrl(params.unsubscribeUrl)
    ? `<a href="${escapeHtml(params.unsubscribeUrl.trim())}" style="color:#135854;">abonelikten çıkın</a>`
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
