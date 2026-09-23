/**
 * Admin operation e-mails (phase 3).
 *
 * These go to a configured operations mailbox, not to a person, so the tone is
 * operational: what happened, which order / seller / customer, how much money is
 * involved, which queue it is waiting in, and one link into the admin panel.
 */

import type {
  AdminBankTransferPendingEmailInput,
  AdminDisputeOpenedEmailInput,
  AdminFulfillmentRiskEmailInput,
  AdminOrderCancellationEmailInput,
  AdminReturnRequestedEmailInput,
  AdminSellerApplicationEmailInput,
  AdminSupportTicketEmailInput,
  EmailTemplate,
} from './types'
import {
  amountText,
  escapeHtml,
  heading,
  layout,
  paragraph,
  renderCta,
  renderInfoBox,
  renderLineItemsTable,
  renderLineItemsText,
} from './shared'

const SUBJECT_PREFIX = 'Hanuja Yönetim'

function subjectOf(label: string, suffix?: string | null) {
  return suffix
    ? `${SUBJECT_PREFIX} — ${label}: ${suffix}`
    : `${SUBJECT_PREFIX} — ${label}`
}

function orderLabel(orderNumber: string) {
  return `#${orderNumber}`
}

/** Short free-text block (reason, message) — truncated and escaped. */
function excerpt(value: string | null | undefined, limit = 400) {
  const text = (value ?? '').trim()
  if (!text) return ''
  return escapeHtml(text.length > limit ? `${text.slice(0, limit)}…` : text)
}

function textLines(lines: ReadonlyArray<string | null | undefined>) {
  return lines
    .filter((line): line is string => !!line && line.trim() !== '')
    .join('\n')
}

export const FULFILLMENT_RISK_LEVEL_LABELS: Record<string, string> = {
  warning: 'Uyarı — sevk taahhüdü yaklaşıyor',
  breached: 'Gecikme — sevk taahhüdü aşıldı',
  resolved: 'Giderildi',
}

export function fulfillmentRiskLevelLabel(level: string) {
  return FULFILLMENT_RISK_LEVEL_LABELS[level] ?? level
}

export function adminOrderCancellationTemplate(
  params: AdminOrderCancellationEmailInput,
): EmailTemplate {
  const title = `Sipariş ${orderLabel(params.orderNumber)} için iptal kaydedildi`
  const reason = excerpt(params.reason)
  const html = layout(
    title,
    `${heading(title)}
    ${renderInfoBox([
      ['Sipariş', orderLabel(params.orderNumber)],
      ['İptali yapan', params.actorLabel],
      ['Satıcı', params.sellerName],
      ['Müşteri', params.customerName],
      ['İade tutarı', params.refundAmount ? amountText(params.refundAmount) : null],
    ])}
    ${reason ? paragraph(`<strong>Gerekçe:</strong> ${reason}`) : ''}
    ${params.items?.length ? renderLineItemsTable(params.items, { quantityLabel: 'İptal', hideAmounts: true }) : ''}
    ${renderCta('Siparişi aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf('Sipariş iptali', orderLabel(params.orderNumber)),
    html,
    text: textLines([
      title,
      params.actorLabel ? `İptali yapan: ${params.actorLabel}` : null,
      params.sellerName ? `Satıcı: ${params.sellerName}` : null,
      params.customerName ? `Müşteri: ${params.customerName}` : null,
      params.refundAmount ? `İade tutarı: ${amountText(params.refundAmount)}` : null,
      params.reason ? `Gerekçe: ${params.reason}` : null,
      params.items?.length
        ? renderLineItemsText(params.items, { quantityLabel: 'İptal', hideAmounts: true })
        : null,
      params.adminUrl,
    ]),
  }
}

export function adminReturnRequestedTemplate(
  params: AdminReturnRequestedEmailInput,
): EmailTemplate {
  const title = `Sipariş ${orderLabel(params.orderNumber)} için iade talebi açıldı`
  const reason = excerpt(params.reason)
  const html = layout(
    title,
    `${heading(title)}
    ${renderInfoBox([
      ['Sipariş', orderLabel(params.orderNumber)],
      ['Satıcı', params.sellerName],
      ['Müşteri', params.customerName],
      ['Akış', params.flowLabel],
    ])}
    ${reason ? paragraph(`<strong>İade gerekçesi:</strong> ${reason}`) : ''}
    ${params.items?.length ? renderLineItemsTable(params.items, { quantityLabel: 'İade', hideAmounts: true }) : ''}
    ${renderCta('İade taleplerini aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf('İade talebi', orderLabel(params.orderNumber)),
    html,
    text: textLines([
      title,
      params.sellerName ? `Satıcı: ${params.sellerName}` : null,
      params.customerName ? `Müşteri: ${params.customerName}` : null,
      params.reason ? `İade gerekçesi: ${params.reason}` : null,
      params.items?.length
        ? renderLineItemsText(params.items, { quantityLabel: 'İade', hideAmounts: true })
        : null,
      params.adminUrl,
    ]),
  }
}

export function adminDisputeOpenedTemplate(
  params: AdminDisputeOpenedEmailInput,
): EmailTemplate {
  const title = `Sipariş ${orderLabel(params.orderNumber)} için uyuşmazlık açıldı`
  const reason = excerpt(params.reason)
  const html = layout(
    title,
    `${heading(title)}
    ${paragraph(
      'Uyuşmazlık açık olduğu sürece ilgili siparişin hakedişi bloklanır. İncelemeyi tamamlayıp sonucu yazın.',
    )}
    ${renderInfoBox([
      ['Sipariş', orderLabel(params.orderNumber)],
      ['Satıcı', params.sellerName],
      ['Müşteri', params.customerName],
      ['Kaynak', params.sourceLabel],
    ])}
    ${reason ? paragraph(`<strong>Gerekçe:</strong> ${reason}`) : ''}
    ${renderCta('Uyuşmazlığı aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf('Uyuşmazlık açıldı', orderLabel(params.orderNumber)),
    html,
    text: textLines([
      title,
      params.sellerName ? `Satıcı: ${params.sellerName}` : null,
      params.customerName ? `Müşteri: ${params.customerName}` : null,
      params.sourceLabel ? `Kaynak: ${params.sourceLabel}` : null,
      params.reason ? `Gerekçe: ${params.reason}` : null,
      params.adminUrl,
    ]),
  }
}

function supportTicketTemplate(
  params: AdminSupportTicketEmailInput,
  audience: 'seller' | 'customer',
): EmailTemplate {
  const who = audience === 'seller' ? 'Satıcı' : 'Müşteri'
  const title = `${who} destek bileti: ${params.subject}`
  const message = excerpt(params.message)
  const html = layout(
    title,
    `${heading(title)}
    ${renderInfoBox([
      ['Bilet', params.ticketNumber],
      [who, params.requesterName],
      ['Konu', params.subject],
      ['Kategori', params.categoryLabel],
      ['Öncelik', params.priorityLabel],
    ])}
    ${message ? paragraph(`<strong>Mesaj:</strong> ${message}`) : ''}
    ${renderCta('Bileti aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf(`${who} destek bileti`, params.subject),
    html,
    text: textLines([
      title,
      params.ticketNumber ? `Bilet: ${params.ticketNumber}` : null,
      params.requesterName ? `${who}: ${params.requesterName}` : null,
      params.categoryLabel ? `Kategori: ${params.categoryLabel}` : null,
      params.message ? `Mesaj: ${params.message}` : null,
      params.adminUrl,
    ]),
  }
}

export function adminSellerSupportTicketTemplate(
  params: AdminSupportTicketEmailInput,
): EmailTemplate {
  return supportTicketTemplate(params, 'seller')
}

export function adminCustomerSupportTicketTemplate(
  params: AdminSupportTicketEmailInput,
): EmailTemplate {
  return supportTicketTemplate(params, 'customer')
}

export function adminBankTransferPendingTemplate(
  params: AdminBankTransferPendingEmailInput,
): EmailTemplate {
  const title = `Havale / EFT onayı bekliyor — sipariş ${orderLabel(params.orderNumber)}`
  const html = layout(
    title,
    `${heading(title)}
    ${paragraph(
      'Ödeme onaylanana kadar sipariş satıcıya düşmez. Banka hesabına geçen tutarı doğrulayıp onay verin.',
    )}
    ${renderInfoBox([
      ['Sipariş', orderLabel(params.orderNumber)],
      ['Müşteri', params.customerName],
      ['Tutar', params.totalAmount ? amountText(params.totalAmount) : null],
      ['Havale referansı', params.reference],
      ['Banka', params.bankName],
    ])}
    ${renderCta('Ödeme onay kuyruğunu aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf('Havale / EFT onayı bekliyor', orderLabel(params.orderNumber)),
    html,
    text: textLines([
      title,
      params.customerName ? `Müşteri: ${params.customerName}` : null,
      params.totalAmount ? `Tutar: ${amountText(params.totalAmount)}` : null,
      params.reference ? `Havale referansı: ${params.reference}` : null,
      params.adminUrl,
    ]),
  }
}

export function adminFulfillmentRiskTemplate(
  params: AdminFulfillmentRiskEmailInput,
): EmailTemplate {
  const level = fulfillmentRiskLevelLabel(params.riskLevel)
  const title = `Sevk riski (${level}) — sipariş ${orderLabel(params.orderNumber)}`
  const html = layout(
    title,
    `${heading(title)}
    ${renderInfoBox([
      ['Sipariş', orderLabel(params.orderNumber)],
      ['Risk seviyesi', level],
      ['Satıcı', params.sellerName],
      ['Sevk taahhüdü', params.deadlineLabel],
      [
        'Gecikme',
        params.overdueDays && params.overdueDays > 0 ? `${params.overdueDays} gün` : null,
      ],
    ])}
    ${params.items?.length ? renderLineItemsTable(params.items, { quantityLabel: 'Adet', hideAmounts: true }) : ''}
    ${renderCta('Siparişi aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf(`Sevk riski (${level})`, orderLabel(params.orderNumber)),
    html,
    text: textLines([
      title,
      params.sellerName ? `Satıcı: ${params.sellerName}` : null,
      params.deadlineLabel ? `Sevk taahhüdü: ${params.deadlineLabel}` : null,
      params.overdueDays && params.overdueDays > 0
        ? `Gecikme: ${params.overdueDays} gün`
        : null,
      params.items?.length
        ? renderLineItemsText(params.items, { quantityLabel: 'Adet', hideAmounts: true })
        : null,
      params.adminUrl,
    ]),
  }
}

export function adminSellerApplicationTemplate(
  params: AdminSellerApplicationEmailInput,
): EmailTemplate {
  const resubmission = (params.submissionSeq ?? 1) > 1
  const title = resubmission
    ? `Satıcı başvurusu yeniden incelemeye gönderildi: ${params.sellerName}`
    : `Yeni satıcı başvurusu: ${params.sellerName}`
  const html = layout(
    title,
    `${heading(title)}
    ${renderInfoBox([
      ['Mağaza', params.sellerName],
      ['Firma', params.companyName],
      ['Şehir', params.city],
      ['Vergi No', params.taxNumber],
      ['Gönderim', resubmission ? `${params.submissionSeq}. gönderim` : 'İlk başvuru'],
    ])}
    ${paragraph('Başvuru belgeleri ve mağaza bilgileri incelenmeyi bekliyor.')}
    ${renderCta('Başvuruyu aç', params.adminUrl)}`,
  )
  return {
    subject: subjectOf(
      resubmission ? 'Satıcı başvurusu yeniden gönderildi' : 'Yeni satıcı başvurusu',
      params.sellerName,
    ),
    html,
    text: textLines([
      title,
      params.companyName ? `Firma: ${params.companyName}` : null,
      params.city ? `Şehir: ${params.city}` : null,
      params.taxNumber ? `Vergi No: ${params.taxNumber}` : null,
      params.adminUrl,
    ]),
  }
}
