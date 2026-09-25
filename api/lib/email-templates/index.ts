/**
 * Email template factory functions.
 * Each function returns { subject, html, text } ready for sendEmail().
 *
 * Language: Turkish (primary platform language).
 * All amounts are formatted as Turkish Lira (TL) using formatMoney.
 *
 * Shared helpers (escaping, layout, line table) live in ./shared; customer
 * lifecycle templates that were added in the e-mail phase 2 work live in
 * ./order-lifecycle.
 */

import type {
  BankTransferInstruction,
  CustomerInvoiceEmailInput,
  CustomerOrderConfirmationEmailInput,
  CustomerOrderEmailInput,
  CustomerPaymentConfirmedEmailInput,
  CustomerProductQuestionAnsweredEmailInput,
  CustomerRefundCompletedEmailInput,
  CustomerReturnRequestEmailInput,
  CustomerShipmentEmailInput,
  EmailAmount,
  EmailOrderLineInput,
  EmailTemplate,
  OrderAmountSummary,
  SellerCancellationEmailInput,
  SellerOrderEmailInput,
  SellerProductQuestionEmailInput,
  SellerReturnRequestEmailInput,
} from './types'
import {
  amountText,
  escapeHtml,
  greeting,
  heading,
  isSafeHttpUrl,
  layout,
  paragraph,
  renderCta,
  renderInfoBox,
  renderLineItemsTable,
  renderLineItemsText,
  renderLink,
  renderTotal,
} from './shared'
import { renderWithdrawalNotice, renderWithdrawalNoticeText } from './withdrawal-notice'
import { cancellationActorLabel } from './order-lifecycle'
import { marketingFooterHtml, marketingFooterText } from './marketing-footer'

export type {
  AdminBankTransferPendingEmailInput,
  AdminDisputeOpenedEmailInput,
  AdminFulfillmentRiskEmailInput,
  AdminOrderCancellationEmailInput,
  AdminReturnRequestedEmailInput,
  AdminSellerApplicationEmailInput,
  AdminSupportTicketEmailInput,
  BankTransferInstruction,
  CancellationActorRole,
  CustomerCancellationEmailInput,
  CustomerDeliveryConfirmedEmailInput,
  CustomerInvoiceEmailInput,
  CustomerOrderConfirmationEmailInput,
  CustomerOrderEmailInput,
  CustomerPaymentConfirmedEmailInput,
  CustomerRefundCompletedEmailInput,
  CustomerReturnCargoInfoEmailInput,
  CustomerReturnDecisionEmailInput,
  CustomerReturnRequestEmailInput,
  CustomerShipmentEmailInput,
  EmailAmount,
  FlexibleEmailOrderLine,
  EmailOrderLine,
  EmailOrderLineInput,
  EmailTemplate,
  LegacyEmailOrderLine,
  OrderAmountSummary,
  OrderContractLinks,
  RefundOutcome,
  ReturnDecision,
  ReturnDecisionLine,
  SellerAnnouncementEmailInput,
  SellerCancellationEmailInput,
  SellerOrderEmailInput,
  SellerReturnRequestEmailInput,
} from './types'

export {
  customerOrderCancelledTemplate,
  deliveryConfirmedTemplate,
  returnCargoInfoReadyTemplate,
  returnDecisionTemplate,
} from './order-lifecycle'

export {
  adminBankTransferPendingTemplate,
  adminCustomerSupportTicketTemplate,
  adminDisputeOpenedTemplate,
  adminFulfillmentRiskTemplate,
  adminOrderCancellationTemplate,
  adminReturnRequestedTemplate,
  adminSellerApplicationTemplate,
  adminSellerSupportTicketTemplate,
  fulfillmentRiskLevelLabel,
} from './admin-operations'

export {
  customerProductQuestionAnsweredTemplate,
  sellerProductQuestionTemplate,
} from './product-questions'

export { sellerAnnouncementTemplate } from './announcements'
export { productPriceDropTemplate, PRICE_DROP_SUBJECT } from './product-price-drop'

function customerOrderUrl(
  params: Pick<CustomerOrderEmailInput, 'orderUrl' | 'customerOrderUrl' | 'orderLink'>,
): string | undefined {
  return params.orderUrl ?? params.customerOrderUrl ?? params.orderLink
}

function sellerOrderUrl(params: SellerOrderEmailInput): string | undefined {
  return params.panelUrl ?? params.sellerPanelUrl ?? params.panelLink ?? params.orderUrl
}

function paymentMethodLabel(method: 'card' | 'eft' | null | undefined): string {
  return method === 'eft' ? 'Havale / EFT' : method === 'card' ? 'Kredi Kartı' : ''
}

/** Ara toplam / indirim / kargo / toplam satırları — yalnız sağlanan alanlar basılır. */
function renderAmountSummary(summary: OrderAmountSummary | undefined, total: EmailAmount): string {
  const rows: Array<[string, EmailAmount, boolean]> = []
  if (summary?.subtotal !== undefined) rows.push(['Ürünler', summary.subtotal, false])
  if (summary?.couponDiscount !== undefined)
    rows.push([
      `Kupon İndirimi${summary.couponCode ? ` (${summary.couponCode})` : ''}`,
      summary.couponDiscount,
      true,
    ])
  if (summary?.eftDiscount !== undefined)
    rows.push([
      `Havale / EFT İndirimi${summary.eftDiscountRate ? ` (${summary.eftDiscountRate})` : ''}`,
      summary.eftDiscount,
      true,
    ])
  if (summary?.additionalDiscount !== undefined)
    rows.push(['Ek İndirim', summary.additionalDiscount, true])
  if (summary?.shipping !== undefined) rows.push(['Kargo', summary.shipping, false])
  const body = rows
    .map(
      ([label, value, negative]) => `<tr>
        <td style="font-size:13px;color:#555;padding:4px 0;text-align:right;">${escapeHtml(label)}</td>
        <td width="34%" style="font-size:13px;color:#333;padding:4px 0 4px 12px;text-align:right;">${negative ? '−' : ''}${escapeHtml(amountText(value))}</td>
      </tr>`,
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tbody>${body}
      <tr>
        <td style="font-size:15px;font-weight:bold;color:#1a1a1a;padding:10px 0 0;text-align:right;border-top:1px solid #eee;">Toplam</td>
        <td width="34%" style="font-size:15px;font-weight:bold;color:#1a1a1a;padding:10px 0 0 12px;text-align:right;border-top:1px solid #eee;">${escapeHtml(amountText(total))}</td>
      </tr></tbody></table>`
}

function renderAmountSummaryText(summary: OrderAmountSummary | undefined, total: EmailAmount): string {
  const lines: string[] = []
  if (summary?.subtotal !== undefined) lines.push(`Ürünler: ${amountText(summary.subtotal)}`)
  if (summary?.couponDiscount !== undefined)
    lines.push(
      `Kupon İndirimi${summary.couponCode ? ` (${summary.couponCode})` : ''}: -${amountText(summary.couponDiscount)}`,
    )
  if (summary?.eftDiscount !== undefined)
    lines.push(
      `Havale / EFT İndirimi${summary.eftDiscountRate ? ` (${summary.eftDiscountRate})` : ''}: -${amountText(summary.eftDiscount)}`,
    )
  if (summary?.additionalDiscount !== undefined)
    lines.push(`Ek İndirim: -${amountText(summary.additionalDiscount)}`)
  if (summary?.shipping !== undefined) lines.push(`Kargo: ${amountText(summary.shipping)}`)
  lines.push(`Toplam: ${amountText(total)}`)
  return lines.join('\n')
}

function renderBankInstructions(
  instructions: CustomerOrderConfirmationEmailInput['bankTransferInstructions'],
  orderNumber: string,
): { html: string; text: string } {
  const list: readonly BankTransferInstruction[] = Array.isArray(instructions)
    ? instructions
    : instructions
      ? [instructions as BankTransferInstruction]
      : []
  const usable = list.filter((entry) => !entry.missing && entry.iban?.trim())
  if (usable.length === 0) {
    return {
      html: paragraph(
        'Banka bilgileri için lütfen destek ekibimizle iletişime geçin.',
        'margin:16px 0 0;font-size:14px;color:#555;',
      ),
      text: 'Banka bilgileri için lütfen destek ekibimizle iletişime geçin.',
    }
  }
  const reference = usable[0]?.reference ?? orderNumber
  const boxes = usable
    .map((entry) =>
      renderInfoBox(
        [
          ['Banka', entry.bankName],
          ['Şube', entry.branchName ?? null],
          ['Hesap Sahibi', entry.accountHolder],
          ['Not', entry.accountHolderNote ?? null],
          ['IBAN', entry.iban],
          ['Açıklama / Referans', entry.reference ?? orderNumber],
        ],
        'margin:12px 0 0;',
      ),
    )
    .join('')
  return {
    html: `${boxes}${paragraph(
      'Havale / EFT açıklamasına sipariş numaranızı yazmayı unutmayın. Ödemeniz onaylandıktan sonra siparişiniz hazırlanmaya başlanacak ve size ayrıca bilgi verilecektir.',
      'margin:16px 0 24px;font-size:14px;color:#555;',
    )}`,
    text: usable
      .map(
        (entry) =>
          `${entry.bankName}${entry.branchName ? ` / ${entry.branchName}` : ''} — ${entry.accountHolder} — IBAN: ${entry.iban} — Referans: ${entry.reference ?? orderNumber}`,
      )
      .join('\n')
      .concat(`\nReferans: ${reference}. Ödemeniz onaylandıktan sonra siparişiniz hazırlanmaya başlanacaktır.`),
  }
}

/**
 * "Siparişiniz Alındı" — kart siparişinde yalnız ödeme onaylandıktan sonra,
 * EFT siparişinde sipariş anında (ödeme bekleniyor) gönderilir. Sözleşme
 * bağlantıları ve 14 gün cayma hakkı bloğu bu e-postada yer alır.
 */
export function orderConfirmationTemplate(
  params: CustomerOrderConfirmationEmailInput,
): EmailTemplate {
  const orderUrl = customerOrderUrl(params)
  const paymentStatus = params.paymentStatus ?? (params.paymentMethod === 'eft' ? 'pending' : 'confirmed')
  const pending = paymentStatus === 'pending'
  const paymentLabel = paymentMethodLabel(params.paymentMethod)
  const title = pending ? 'Siparişiniz Alındı — Ödeme Bekleniyor' : 'Siparişiniz Alındı'
  const statusCopy = pending
    ? 'Ödemeniz henüz alınmadı. Aşağıdaki hesaba havale / EFT yaptığınızda ödemeniz kontrol edilip onaylanacaktır.'
    : 'Ödemeniz alındı ve siparişiniz satıcıya iletildi. Kargoya verildiğinde size ayrıca bilgi vereceğiz.'
  const bank = pending ? renderBankInstructions(params.bankTransferInstructions, params.orderNumber) : null
  const contracts = params.contracts ?? {}
  const contractLinks = [
    ['Ön Bilgilendirme Formu', contracts.preInformationUrl],
    ['Mesafeli Satış Sözleşmesi', contracts.distanceSalesUrl],
  ].filter(([, url]) => isSafeHttpUrl(url))
  const contractsHtml = contractLinks.length
    ? paragraph(
        `Sipariş anında onayladığınız belgeler: ${contractLinks
          .map(([label, url]) => renderLink(String(label), String(url)))
          .join(' · ')}`,
        'margin:0 0 24px;font-size:13px;color:#555;',
      )
    : ''

  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizi aldık. ${escapeHtml(statusCopy)}`)}
    ${paragraph(`<strong>Ödeme Yöntemi:</strong> ${paymentLabel}${pending ? ' — <strong>ödeme bekleniyor</strong>' : ' — ödeme alındı'}`, 'margin:0 0 12px;font-size:14px;color:#555;')}
    ${renderLineItemsTable(params.items, { style: 'margin-bottom:8px;' })}
    ${renderAmountSummary(params.summary, params.totalAmount)}
    ${bank ? bank.html : '<div style="height:24px;"></div>'}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
    ${contractsHtml}
    ${renderWithdrawalNotice(contracts)}
  `

  const textLines = [
    `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizi aldık. ${statusCopy}`,
    `Ödeme yöntemi: ${paymentLabel}${pending ? ' (ödeme bekleniyor)' : ''}.`,
    renderLineItemsText(params.items),
    renderAmountSummaryText(params.summary, params.totalAmount),
    ...(bank ? [bank.text] : []),
    ...(orderUrl ? [`Sipariş detayı: ${orderUrl}`] : []),
    renderWithdrawalNoticeText(contracts),
  ]

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: textLines.join('\n'),
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
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz oluşturuldu.`)}
    ${renderLineItemsTable(params.items)}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz oluşturuldu.\n${renderLineItemsText(params.items)}${params.totalAmount === undefined ? '' : `\nToplam: ${amountText(params.totalAmount)}`}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** Customer event sent when an EFT payment is approved by the admin. */
export function orderPaymentConfirmedTemplate(
  params: CustomerPaymentConfirmedEmailInput,
): EmailTemplate {
  const title = 'Ödemeniz Onaylandı'
  const orderUrl = customerOrderUrl(params)
  const paymentLabel = paymentMethodLabel(params.paymentMethod)
  const paymentCopy = paymentLabel ? ` (${paymentLabel})` : ''
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(
      `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizin ödemesi onaylandı${escapeHtml(paymentCopy)}. Siparişiniz satıcıya iletildi ve hazırlık sürecine alındı; kargoya verildiğinde size ayrıca bilgi vereceğiz.`,
    )}
    ${renderLineItemsTable(params.items, { style: 'margin-bottom:8px;' })}
    ${params.summary ? renderAmountSummary(params.summary, params.totalAmount ?? '') : renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  const textLines = [
    `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizin ödemesi onaylandı${paymentCopy}. Siparişiniz hazırlık sürecine alındı.`,
    renderLineItemsText(params.items),
    params.summary
      ? renderAmountSummaryText(params.summary, params.totalAmount ?? '')
      : params.totalAmount === undefined
        ? ''
        : `Toplam: ${amountText(params.totalAmount)}`,
    ...(orderUrl ? [`Sipariş detayı: ${orderUrl}`] : []),
  ].filter(Boolean)

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: textLines.join('\n'),
  }
}

// Descriptive aliases keep event terminology available to callers without
// changing the original public template names.
export const orderCreatedEmailTemplate = orderCreatedTemplate
export const orderPaymentConfirmedEmailTemplate = orderPaymentConfirmedTemplate
export const customerOrderCreatedTemplate = orderCreatedTemplate
export const customerPaymentConfirmedTemplate = orderPaymentConfirmedTemplate
export const paymentConfirmedTemplate = orderPaymentConfirmedTemplate

/** Shipment notification — sent to customer when (part of) the order is handed to cargo. */
export function shipmentNotificationTemplate(params: CustomerShipmentEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const title = 'Siparişiniz Kargoya Verildi'
  const trackingNumber = params.trackingNumber?.trim() || ''
  const cargoCompany = params.cargoCompany?.trim() || 'Belirtilmedi'
  const trackingUrl = isSafeHttpUrl(params.trackingUrl) ? params.trackingUrl.trim() : null
  const sellerCopy = params.sellerName
    ? ` <strong>${escapeHtml(params.sellerName)}</strong> tarafından gönderilen ürünler aşağıdadır.`
    : ''
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(
      `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizdeki ürünler kargoya verildi.${sellerCopy}`,
      'margin:0 0 16px;font-size:15px;color:#555;',
    )}
    ${renderInfoBox([
      ['Kargo Firması', cargoCompany],
      ['Takip Numarası', trackingNumber || 'Henüz paylaşılmadı'],
    ])}
    ${trackingUrl ? renderCta('Kargomu Takip Et', trackingUrl) : ''}
    ${items.length ? renderLineItemsTable(items, { quantityLabel: 'Gönderilen Adet' }) : ''}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
    ${paragraph('Ürün elinize ulaştığında sipariş sayfasından teslimatı onaylayabilirsiniz.', 'margin:0;font-size:13px;color:#777;')}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} siparişinizdeki ürünler kargoya verildi.${params.sellerName ? ` Gönderen: ${params.sellerName}.` : ''} Kargo firması: ${cargoCompany}. Takip no: ${trackingNumber || 'Henüz paylaşılmadı'}.${trackingUrl ? `\nKargo takip: ${trackingUrl}` : ''}${items.length ? `\n${renderLineItemsText(items, { quantityLabel: 'Gönderilen Adet' })}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

export const orderShippedTemplate = shipmentNotificationTemplate
export const orderShippedEmailTemplate = shipmentNotificationTemplate
export const customerOrderShippedTemplate = shipmentNotificationTemplate

/** Invoice uploaded — sent to customer when the seller's product invoice is available. */
export function invoiceUploadedTemplate(params: CustomerInvoiceEmailInput): EmailTemplate {
  const title = 'Faturanız Oluşturuldu'
  const items = params.items ?? []
  const invoiceCta = renderCta('Faturayı Görüntüle', params.invoiceUrl)
  const orderCta = renderCta('Siparişimi Görüntüle', params.orderUrl)
  const sellerCopy = params.sellerName
    ? `<strong>${escapeHtml(params.sellerName)}</strong> mağazası`
    : 'satıcı'
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(
      `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için ${sellerCopy} tarafından ürün faturası oluşturuldu. Faturanızı hesabınıza giriş yaparak görüntüleyebilir ve indirebilirsiniz.`,
    )}
    ${items.length ? renderLineItemsTable(items) : ''}
    ${invoiceCta}
    ${orderCta}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz için ${params.sellerName ? `${params.sellerName} mağazası` : 'satıcı'} tarafından ürün faturası oluşturuldu. Faturanızı hesabınıza giriş yaparak görüntüleyebilirsiniz.${items.length ? `\n${renderLineItemsText(items)}` : ''}${isSafeHttpUrl(params.invoiceUrl) ? `\nFatura: ${params.invoiceUrl.trim()}` : ''}${isSafeHttpUrl(params.orderUrl) ? `\nSipariş detayı: ${params.orderUrl.trim()}` : ''}`,
  }
}

export function returnRequestTemplate(params: CustomerReturnRequestEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const returnReason = params.returnReason?.trim() || 'Belirtilmedi'
  const title = 'İade Talebiniz Alındı'
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için iade talebinizi aldık.`)}
    ${items.length ? renderLineItemsTable(items, { quantityLabel: 'İade Adedi' }) : ''}
    ${paragraph('<strong>İade Sebebi:</strong>', 'margin:0 0 8px;font-size:14px;color:#555;')}
    ${paragraph(escapeHtml(returnReason), 'margin:0 0 24px;font-size:14px;color:#333;background:#f9f9f9;padding:12px;border-radius:4px;')}
    ${paragraph('Satıcı talebinizi inceleyip iade kargo bilgilerini iletecek; ürünü kargoya verebilmeniz için size ayrıca e-posta göndereceğiz. Talebinizin durumunu sipariş sayfasından takip edebilirsiniz.', 'margin:0 0 24px;font-size:14px;color:#555;')}
    ${renderCta('İade Talebimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} için iade talebinizi aldık. Sebep: ${returnReason}${items.length ? `\n${renderLineItemsText(items, { quantityLabel: 'İade Adedi' })}` : ''}\nSatıcı iade kargo bilgilerini iletince size ayrıca e-posta göndereceğiz.${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** Customer event emitted once the refund money movement is finalised. */
export function refundCompletedTemplate(params: CustomerRefundCompletedEmailInput): EmailTemplate {
  const items = params.items ?? []
  const orderUrl = customerOrderUrl(params)
  const title = 'Geri Ödemeniz Yapılmıştır'
  const method =
    params.paymentMethod === 'card'
      ? 'ödeme yaptığınız karta'
      : params.paymentMethod === 'eft'
        ? 'bildirdiğiniz IBAN hesabına'
        : 'ödeme yönteminize'
  const amountCopy =
    params.refundAmount === undefined ? '' : ` <strong>${escapeHtml(amountText(params.refundAmount))}</strong> tutarındaki`
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(
      `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için${amountCopy} geri ödeme ${method} aktarıldı. Bankanıza bağlı olarak tutarın hesabınıza yansıması birkaç iş günü sürebilir.`,
    )}
    ${items.length ? renderLineItemsTable(items, { quantityLabel: 'Adet' }) : ''}
    ${params.refundAmount === undefined ? '' : `<p style="margin:0 0 24px;text-align:right;font-size:15px;font-weight:bold;color:#1a1a1a;">İade Tutarı: ${escapeHtml(amountText(params.refundAmount))}</p>`}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişiniz için${params.refundAmount === undefined ? '' : ` ${amountText(params.refundAmount)} tutarındaki`} geri ödeme ${method} aktarıldı. Tutarın hesabınıza yansıması birkaç iş günü sürebilir.${items.length ? `\n${renderLineItemsText(items)}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
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

/** Seller event sent after the order payment is confirmed. */
export function sellerNewOrderTemplate(params: SellerOrderEmailInput): EmailTemplate {
  const title = 'Yeni Sipariş'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişte ödemesi onaylanmış yeni kalemleriniz var. Lütfen siparişi satıcı panelinden onaylayıp sevk süresi içinde kargoya verin.`)}
    ${renderLineItemsTable(items)}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Satıcı Panelinde Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişte ödemesi onaylanmış yeni kalemleriniz var.\n${renderLineItemsText(items)}${params.totalAmount === undefined ? '' : `\nToplam: ${amountText(params.totalAmount)}`}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

/** Seller event for a product/quantity cancellation made by the customer or admin. */
export function sellerOrderCancellationTemplate(
  params: SellerCancellationEmailInput,
): EmailTemplate {
  const title = 'Sipariş İptali'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const reason = params.cancellationReason?.trim()
  const actor = params.actorRole ? cancellationActorLabel(params.actorRole) : null
  const scope = params.partial ? 'aşağıdaki ürün/adetler' : 'size ait kalemler'
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişte ${scope}${actor ? ` ${escapeHtml(actor)} tarafından` : ''} iptal edildi. İptal edilen ürünleri kargoya vermeyin.`)}
    ${renderLineItemsTable(items, { quantityLabel: 'İptal Adedi' })}
    ${reason ? paragraph(`<strong>İptal Nedeni:</strong> ${escapeHtml(reason)}`, 'margin:0 0 24px;font-size:14px;color:#555;') : ''}
    ${renderTotal(params.totalAmount)}
    ${renderCta('Satıcı Panelinde Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı siparişte ${scope}${actor ? ` ${actor} tarafından` : ''} iptal edildi.\n${renderLineItemsText(items, { quantityLabel: 'İptal Adedi' })}${reason ? `\nİptal nedeni: ${reason}` : ''}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

/** Seller event for a newly opened return request. */
export function sellerReturnRequestTemplate(params: SellerReturnRequestEmailInput): EmailTemplate {
  const title = 'İade Talebi'
  const orderUrl = sellerOrderUrl(params)
  const items = sellerScopedItems(params)
  const reason = params.returnReason?.trim()
  const body = `
    ${heading(title)}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı sipariş için müşteri iade talebi oluşturdu.`)}
    ${renderLineItemsTable(items, { quantityLabel: 'İade Adedi' })}
    ${reason ? paragraph(`<strong>İade Nedeni:</strong> ${escapeHtml(reason)}`, 'margin:0 0 24px;font-size:14px;color:#555;') : ''}
    ${paragraph('Talebi satıcı panelinden inceleyip iade kargo bilgilerini müşteriye iletin. Ürün size ulaştığında teslim kararını panelden verebilirsiniz.', 'margin:0 0 24px;font-size:14px;color:#555;')}
    ${renderCta('İade Talebini İncele', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.sellerName}, #${params.orderNumber} numaralı sipariş için iade talebi oluşturuldu.\n${renderLineItemsText(items, { quantityLabel: 'İade Adedi' })}${reason ? `\nİade nedeni: ${reason}` : ''}${orderUrl ? `\nSatıcı paneli: ${orderUrl}` : ''}`,
  }
}

export const sellerNewOrderEmailTemplate = sellerNewOrderTemplate
export const sellerOrderReceivedTemplate = sellerNewOrderTemplate
export const sellerProductCancellationTemplate = sellerOrderCancellationTemplate
export const sellerQuantityCancellationTemplate = sellerOrderCancellationTemplate
export const sellerReturnRequestedTemplate = sellerReturnRequestTemplate
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
    ${heading('Ödemeniz Gerçekleşti')}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>${escapeHtml(params.periodDescription)}</strong> dönemi için satıcı ödemeniz gerçekleştirildi.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Net Ödeme Tutarı:</strong></td>
        <td style="font-size:16px;color:#1a1a1a;font-weight:bold;padding:6px 0;">${escapeHtml(params.payoutAmount)}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>İşlem Tarihi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${escapeHtml(params.payoutDate)}</td>
      </tr>
    </table>
    ${paragraph('Detayları satıcı panelinizden görüntüleyebilirsiniz.', 'margin:0;font-size:14px;color:#555;')}
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
    ${heading('Ceza Uygulandı')}
    ${greeting(params.sellerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı sipariş için hesabınıza ceza uygulandı.`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fecaca;border-radius:6px;padding:16px;margin-bottom:24px;">
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Ceza Tutarı:</strong></td>
        <td style="font-size:16px;color:#dc2626;font-weight:bold;padding:6px 0;">${escapeHtml(params.penaltyAmount)}</td>
      </tr>
      <tr>
        <td style="font-size:14px;color:#555;padding:6px 0;"><strong>Ceza Sebebi:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;">${escapeHtml(params.penaltyReason)}</td>
      </tr>
    </table>
    ${paragraph('Ceza tutarı bir sonraki ödemenizden mahsup edilecektir. Detaylar için satıcı panelinizi inceleyebilirsiniz.', 'margin:0;font-size:14px;color:#555;')}
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
      Bu e-postayı mağaza bildirimleri için alıyorsunuz. Desteklenen posta kutularında
      <strong>RET</strong> yazarak yanıtlamak da e-posta bildirimlerini kapatır.
    </p>
    ${marketingFooterHtml(params.unsubscribeUrl)}
  `

  return {
    subject: `${params.sellerName} mağazasında indirim başladı`,
    html: layout('Takip Ettiğiniz Mağazada İndirim Var', body),
    text: `Merhaba ${params.customerName}, ${params.sellerName} mağazasında indirim başladı. Mağaza: ${params.storeUrl}\n\n${marketingFooterText(params.unsubscribeUrl)}`,
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
  const title = isFavorite
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

  const body = `
    <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${title}</h2>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${customerNameHtml},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#555;">${lead}</p>
    <p style="margin:0 0 24px;">
      ${productCta}
    </p>
    ${marketingFooterHtml(params.unsubscribeUrl)}
  `

  const textLead = isFavorite
    ? `Favorilerinize eklediğiniz ${params.productName} ürünü, ${params.sellerName} mağazasında şimdi indirimde.`
    : `Sepetinizdeki ${params.productName} ürünü, ${params.sellerName} mağazasında şimdi indirimde.`

  return {
    subject: title,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, ${textLead} Ürünü incele: ${params.productUrl}\n\n${marketingFooterText(params.unsubscribeUrl)}`,
  }
}

export { sellerApprovalTemplate } from './seller-approval'
export { sellerPasswordResetTemplate } from './seller-password-reset'
export { sellerDocumentsRequestedTemplate } from './seller-documents-requested'
export { passwordResetTemplate } from './password-reset'
export { passwordChangedTemplate } from './password-changed'
