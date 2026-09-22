/**
 * Customer lifecycle e-mails added in e-mail phase 2: cancellation, delivery
 * confirmation and return decisions. Pure renderers — callers pass
 * display-formatted amounts and absolute URLs.
 */

import type {
  CancellationActorRole,
  CustomerCancellationEmailInput,
  CustomerDeliveryConfirmedEmailInput,
  CustomerReturnCargoInfoEmailInput,
  CustomerReturnDecisionEmailInput,
  EmailTemplate,
  ReturnDecisionLine,
} from './types'
import {
  amountText,
  escapeHtml,
  greeting,
  heading,
  layout,
  normalizeLineItem,
  paragraph,
  renderCta,
  renderInfoBox,
  renderLineItemsTable,
  renderLineItemsText,
} from './shared'

export function cancellationActorLabel(role: CancellationActorRole): string {
  switch (role) {
    case 'customer':
      return 'müşteri'
    case 'seller':
      return 'satıcı'
    case 'admin':
      return 'Hanuja'
    case 'payment_failure':
      return 'ödeme alınamadığı için sistem'
    case 'system':
    default:
      return 'sistem'
  }
}

function orderUrlOf(params: { orderUrl?: string; customerOrderUrl?: string; orderLink?: string }) {
  return params.orderUrl ?? params.customerOrderUrl ?? params.orderLink
}

/** "Siparişiniz İptal Edilmiştir" — only the cancelled lines/quantities are listed. */
export function customerOrderCancelledTemplate(
  params: CustomerCancellationEmailInput,
): EmailTemplate {
  const orderUrl = orderUrlOf(params)
  const title = params.partial ? 'Siparişinizin Bir Kısmı İptal Edildi' : 'Siparişiniz İptal Edilmiştir'
  const reason = params.reason?.trim()
  const actorCopy: Record<CancellationActorRole, string> = {
    customer: 'talebiniz üzerine iptal edildi.',
    seller: 'satıcı tarafından iptal edildi. Bu durum için üzgünüz.',
    admin: 'Hanuja tarafından iptal edildi.',
    system: 'satıcı sevk süresini aştığı için otomatik olarak iptal edildi. Bu durum için üzgünüz.',
    payment_failure: 'ödeme alınamadığı için iptal edildi. Dilerseniz yeni bir sipariş oluşturabilirsiniz.',
  }
  const scope = params.partial ? 'aşağıdaki ürün/adetler' : 'sipariş'
  const refundCopy =
    params.refundAmount === undefined
      ? params.actorRole === 'payment_failure'
        ? 'Bu sipariş için tahsilat yapılmadı.'
        : ''
      : `Ödediğiniz <strong>${escapeHtml(amountText(params.refundAmount))}</strong> tutar ${
          params.paymentMethod === 'eft' ? 'bildirdiğiniz IBAN hesabına' : 'ödeme yaptığınız karta'
        } iade edilecek; geri ödeme tamamlandığında size ayrıca e-posta göndereceğiz.`
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizde ${scope} ${actorCopy[params.actorRole]}`)}
    ${renderLineItemsTable(params.items, { quantityLabel: 'İptal Adedi' })}
    ${reason ? paragraph(`<strong>İptal Nedeni:</strong> ${escapeHtml(reason)}`, 'margin:0 0 16px;font-size:14px;color:#555;') : ''}
    ${refundCopy ? paragraph(refundCopy, 'margin:0 0 24px;font-size:14px;color:#555;') : ''}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `
  const refundText =
    params.refundAmount === undefined
      ? params.actorRole === 'payment_failure'
        ? 'Bu sipariş için tahsilat yapılmadı.'
        : ''
      : `Ödediğiniz ${amountText(params.refundAmount)} tutar iade edilecek; geri ödeme tamamlandığında ayrıca e-posta göndereceğiz.`

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizde ${scope} ${actorCopy[params.actorRole].replace(/<[^>]+>/g, '')}\n${renderLineItemsText(params.items, { quantityLabel: 'İptal Adedi' })}${reason ? `\nİptal nedeni: ${reason}` : ''}${refundText ? `\n${refundText}` : ''}${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** "Siparişiniz Teslim Edilmiştir" — lists the lines confirmed in this event. */
export function deliveryConfirmedTemplate(
  params: CustomerDeliveryConfirmedEmailInput,
): EmailTemplate {
  const orderUrl = orderUrlOf(params)
  const title = params.partial ? 'Siparişinizin Bir Kısmı Teslim Edildi' : 'Siparişiniz Teslim Edilmiştir'
  const lead = params.partial
    ? `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizdeki aşağıdaki ürünlerin teslimatı onaylandı. Kalan ürünler için ayrıca bilgilendirileceksiniz.`
    : `<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinizin teslimatı onaylandı. Ürünlerinizi beğenerek kullanmanızı dileriz.`
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(lead)}
    ${params.confirmedAt ? renderInfoBox([['Teslim Tarihi', params.confirmedAt]]) : ''}
    ${renderLineItemsTable(params.items, { quantityLabel: 'Teslim Adedi', hideAmounts: true })}
    ${paragraph('Ürünlerinizden memnun kalmadıysanız teslimattan itibaren 14 gün içinde sipariş sayfasından iade talebi oluşturabilirsiniz. Hasarlı, eksik veya yanlış ürün için de aynı sayfadan bize ulaşabilirsiniz.', 'margin:0 0 24px;font-size:14px;color:#555;')}
    ${renderCta('Siparişimi Görüntüle', orderUrl)}
  `

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} numaralı siparişinizin ${params.partial ? 'aşağıdaki ürünlerinin' : ''} teslimatı onaylandı.${params.confirmedAt ? ` Teslim tarihi: ${params.confirmedAt}.` : ''}\n${renderLineItemsText(params.items, { quantityLabel: 'Teslim Adedi', hideAmounts: true })}\nTeslimattan itibaren 14 gün içinde iade talebi oluşturabilirsiniz.${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

/** "İade Talebiniz Kabul Edildi — Ürünü Kargoya Verin" — seller supplied the return cargo details. */
export function returnCargoInfoReadyTemplate(
  params: CustomerReturnCargoInfoEmailInput,
): EmailTemplate {
  const orderUrl = orderUrlOf(params)
  const title = 'İade Talebiniz Kabul Edildi'
  const items = params.items ?? []
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişiniz için iade talebiniz kabul edildi. Satıcı, ürünü göndereceğiniz iade bilgilerini iletti.`)}
    ${renderInfoBox([
      ['İade Adresi', params.cargoAddress ?? null],
      ['Kargo Firması', params.cargoCarrier ?? null],
      ['Talimat', params.cargoInstructions ?? null],
    ])}
    ${items.length ? renderLineItemsTable(items, { quantityLabel: 'İade Adedi', hideAmounts: true }) : ''}
    ${paragraph('Ürünü orijinal ambalajı ve aksesuarlarıyla birlikte belirtilen adrese gönderin; ardından sipariş sayfasından kargo takip numaranızı girin. Ürün satıcıya ulaşıp kontrol edildiğinde iade kararı ve geri ödeme bilgisi size e-posta ile iletilecektir.', 'margin:0 0 24px;font-size:14px;color:#555;')}
    ${renderCta('Kargo Bilgisi Gir', orderUrl)}
  `

  return {
    subject: `${title} — Ürünü Kargoya Verin — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} için iade talebiniz kabul edildi.${params.cargoAddress ? `\nİade adresi: ${params.cargoAddress}` : ''}${params.cargoCarrier ? `\nKargo firması: ${params.cargoCarrier}` : ''}${params.cargoInstructions ? `\nTalimat: ${params.cargoInstructions}` : ''}${items.length ? `\n${renderLineItemsText(items, { quantityLabel: 'İade Adedi', hideAmounts: true })}` : ''}\nÜrünü gönderdikten sonra sipariş sayfasından kargo takip numaranızı girin.${orderUrl ? `\nSipariş detayı: ${orderUrl}` : ''}`,
  }
}

const DECISION_TITLES: Record<CustomerReturnDecisionEmailInput['decision'], string> = {
  approved: 'İade Talebiniz Kabul Edildi',
  partial: 'İade Talebiniz Kısmen Kabul Edildi',
  rejected: 'İade Talebiniz Reddedildi',
}

function renderDecisionRows(items: readonly ReturnDecisionLine[]): string {
  const TD =
    'padding:10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;vertical-align:top;'
  const rows = items
    .map((item) => {
      const line = normalizeLineItem(item)
      const image = line.imageUrl
        ? `<img src="${escapeHtml(line.imageUrl)}" alt="${escapeHtml(line.productName)}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #eee;" />`
        : ''
      const variant = line.variantName
        ? `<br /><small style="color:#777;font-size:12px;">Varyant: ${escapeHtml(line.variantName)}</small>`
        : ''
      const rejection =
        item.rejectedQuantity > 0 && item.rejectionReason?.trim()
          ? `<br /><small style="color:#b91c1c;font-size:12px;">Red gerekçesi: ${escapeHtml(item.rejectionReason.trim())}</small>`
          : ''
      return `<tr>
        <td width="64" style="${TD}width:64px;padding-left:0;">${image}</td>
        <td style="${TD}word-break:break-word;">${escapeHtml(line.productName)}${variant}${rejection}</td>
        <td width="16%" style="${TD}text-align:center;color:#15803d;">${item.acceptedQuantity}</td>
        <td width="16%" style="${TD}text-align:center;color:${item.rejectedQuantity > 0 ? '#b91c1c' : '#333'};padding-right:0;">${item.rejectedQuantity}</td>
      </tr>`
    })
    .join('')
  const TH = 'font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;'
  return `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin-bottom:24px;">
      <thead><tr>
        <th width="64" style="${TH}"></th>
        <th style="${TH}text-align:left;">Ürün / Varyant</th>
        <th width="16%" style="${TH}text-align:center;">Kabul</th>
        <th width="16%" style="${TH}text-align:center;">Red</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

/** Line-level return decision (approved / partially approved / rejected). */
export function returnDecisionTemplate(params: CustomerReturnDecisionEmailInput): EmailTemplate {
  const title = DECISION_TITLES[params.decision]
  const note = params.reviewNote?.trim()
  const nextStep =
    params.decision === 'rejected'
      ? params.disputeOpened
        ? 'Kararı kabul etmiyorsanız endişelenmeyin: talebiniz otomatik olarak Hanuja uyuşmazlık incelemesine taşındı. Sipariş sayfasındaki iade konuşmasından açıklama ve fotoğraf ekleyebilirsiniz; inceleme sonucu size e-posta ile bildirilecektir.'
        : 'Kararla ilgili sorularınız için sipariş sayfasındaki iade konuşmasından bize yazabilirsiniz.'
      : params.decision === 'partial'
        ? `Kabul edilen ürünler için${params.refundAmount === undefined ? '' : ` <strong>${escapeHtml(amountText(params.refundAmount))}</strong> tutarındaki`} geri ödeme kuyruğa alındı; tamamlandığında ayrıca e-posta göndereceğiz.${
            params.disputeOpened
              ? ' Reddedilen ürünler için talebiniz otomatik olarak Hanuja uyuşmazlık incelemesine taşındı; sipariş sayfasındaki iade konuşmasından açıklama ekleyebilirsiniz.'
              : ''
          }`
        : `${params.refundAmount === undefined ? 'Geri ödemeniz' : `<strong>${escapeHtml(amountText(params.refundAmount))}</strong> tutarındaki geri ödemeniz`} kuyruğa alındı; tamamlandığında size ayrıca e-posta göndereceğiz.`
  const body = `
    ${heading(title)}
    ${greeting(params.customerName)}
    ${paragraph(`<strong>#${escapeHtml(params.orderNumber)}</strong> numaralı siparişinize ait iade talebiniz için ürün bazında karar aşağıdadır.`)}
    ${renderDecisionRows(params.items)}
    ${note ? paragraph(`<strong>Açıklama:</strong> ${escapeHtml(note)}`, 'margin:0 0 16px;font-size:14px;color:#555;') : ''}
    ${paragraph(nextStep, 'margin:0 0 24px;font-size:14px;color:#555;')}
    ${renderCta('İade Talebimi Görüntüle', params.orderUrl)}
  `
  const textRows = params.items
    .map((item) => {
      const line = normalizeLineItem(item)
      const variant = line.variantName ? ` / ${line.variantName}` : ''
      const reason =
        item.rejectedQuantity > 0 && item.rejectionReason?.trim()
          ? ` (Red gerekçesi: ${item.rejectionReason.trim()})`
          : ''
      return `${line.productName}${variant} — Kabul: ${item.acceptedQuantity}, Red: ${item.rejectedQuantity}${reason}`
    })
    .join('\n')

  return {
    subject: `${title} — #${params.orderNumber}`,
    html: layout(title, body),
    text: `Merhaba ${params.customerName}, #${params.orderNumber} siparişinize ait iade talebiniz için karar:\n${textRows}${note ? `\nAçıklama: ${note}` : ''}\n${nextStep.replace(/<[^>]+>/g, '')}${params.orderUrl ? `\nSipariş detayı: ${params.orderUrl}` : ''}`,
  }
}
