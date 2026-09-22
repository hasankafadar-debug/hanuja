/**
 * Shared rendering helpers for transactional e-mail templates.
 *
 * Every template file imports from here so that escaping, the mobile-friendly
 * layout shell, money formatting and the product line table stay identical
 * across customer and seller e-mails.
 */

import { DEFAULT_WEB_URL, PLATFORM_LEGAL_INFO } from '../platform-info'
import type { EmailAmount, EmailOrderLineInput } from './types'

/**
 * Escape user/seller-controlled values before interpolating into an HTML email
 * body. Prevents markup/script injection through fields like product or store
 * names. Only for the HTML branch — the text branch stays raw.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** True only for absolute http(s) URLs — blocks javascript:/data: hrefs. */
export function isSafeHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function amountText(value: EmailAmount | null | undefined, fallback = '-'): string {
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

export interface NormalizedEmailLine {
  productName: string
  sellerId: string | undefined
  variantName: string | null
  quantity: number
  unitPrice: EmailAmount | undefined
  lineTotal: EmailAmount | undefined
  imageUrl: string | null
}

export function normalizeLineItem(item: EmailOrderLineInput): NormalizedEmailLine {
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
  const imageUrl = 'imageUrl' in item ? item.imageUrl : undefined
  return {
    productName,
    sellerId: 'sellerId' in item ? item.sellerId : undefined,
    variantName,
    quantity: item.quantity,
    unitPrice,
    lineTotal: ('lineTotal' in item ? item.lineTotal : undefined) ?? unitPrice,
    imageUrl: isSafeHttpUrl(imageUrl) ? imageUrl.trim() : null,
  }
}

const TH = 'font-size:12px;color:#888;padding:0 4px 8px;border-bottom:2px solid #eee;'
const TD =
  'padding:10px 4px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#333;vertical-align:top;'

function renderImageCell(line: NormalizedEmailLine): string {
  const image = line.imageUrl
    ? `<img src="${escapeHtml(line.imageUrl)}" alt="${escapeHtml(line.productName)}" width="56" height="56" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid #eee;" />`
    : ''
  return `<td width="64" style="${TD}width:64px;padding-left:0;">${image}</td>`
}

function renderProductCell(line: NormalizedEmailLine): string {
  const productNameHtml = escapeHtml(line.productName)
  const variantNameHtml = line.variantName ? escapeHtml(line.variantName) : ''
  const productHtml = variantNameHtml
    ? `<span>${productNameHtml}</span><br /><small style="color:#777;font-size:12px;">Varyant: ${variantNameHtml}</small>`
    : productNameHtml
  return `<td style="${TD}word-break:break-word;">${productHtml}</td>`
}

export interface LineItemsTableOptions {
  /** Column caption for the quantity column. */
  quantityLabel?: string
  /** Hide unit price / line total columns (e.g. return decisions). */
  hideAmounts?: boolean
  /** Extra inline style for the table wrapper. */
  style?: string
}

/**
 * Mobile-friendly product line table with an image column. Amount columns are
 * omitted with `hideAmounts` for e-mails where money is shown as a single
 * summary instead of per line.
 */
export function renderLineItemsTable(
  items: readonly EmailOrderLineInput[],
  options: LineItemsTableOptions = {},
): string {
  const quantityLabel = escapeHtml(options.quantityLabel ?? 'Adet')
  const style = options.style ?? 'margin-bottom:24px;'
  const head = options.hideAmounts
    ? `<th width="64" style="${TH}"></th>
        <th style="${TH}text-align:left;">Ürün / Varyant</th>
        <th width="18%" style="${TH}text-align:center;">${quantityLabel}</th>`
    : `<th width="64" style="${TH}"></th>
        <th style="${TH}text-align:left;">Ürün / Varyant</th>
        <th width="12%" style="${TH}text-align:center;">${quantityLabel}</th>
        <th width="20%" style="${TH}text-align:right;">Birim Fiyat</th>
        <th width="20%" style="${TH}text-align:right;">Satır Toplamı</th>`
  const rows = items
    .map((item) => {
      const line = normalizeLineItem(item)
      const amounts = options.hideAmounts
        ? ''
        : `<td style="${TD}text-align:right;word-break:break-word;">${escapeHtml(amountText(line.unitPrice))}</td>
        <td style="${TD}text-align:right;padding-right:0;word-break:break-word;">${escapeHtml(amountText(line.lineTotal))}</td>`
      return `<tr>
        ${renderImageCell(line)}
        ${renderProductCell(line)}
        <td style="${TD}text-align:center;">${line.quantity}</td>
        ${amounts}
      </tr>`
    })
    .join('')
  return `<table class="email-items" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;${style}">
      <thead><tr>
        ${head}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

export function renderLineItemsText(
  items: readonly EmailOrderLineInput[],
  options: { hideAmounts?: boolean; quantityLabel?: string } = {},
): string {
  const quantityLabel = options.quantityLabel ?? 'Adet'
  return items
    .map((item) => {
      const line = normalizeLineItem(item)
      const variant = line.variantName ? ` / ${line.variantName}` : ''
      if (options.hideAmounts) {
        return `${line.productName}${variant} — ${quantityLabel}: ${line.quantity}`
      }
      return `${line.productName}${variant} — ${quantityLabel}: ${line.quantity}, Birim Fiyat: ${amountText(line.unitPrice)}, Satır Toplamı: ${amountText(line.lineTotal)}`
    })
    .join('\n')
}

export function renderCta(label: string, url: string | undefined | null): string {
  if (!isSafeHttpUrl(url)) return ''
  return `<p style="margin:0 0 24px;">
    <a href="${escapeHtml(url.trim())}" style="display:inline-block;background:#135854;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`
}

/** Secondary text link; falls back to plain text for unsafe URLs. */
export function renderLink(label: string, url: string | undefined | null): string {
  if (!isSafeHttpUrl(url)) return escapeHtml(label)
  return `<a href="${escapeHtml(url.trim())}" style="color:#135854;font-weight:600;">${escapeHtml(label)}</a>`
}

export function renderTotal(totalAmount: EmailAmount | undefined): string {
  return totalAmount === undefined
    ? ''
    : `<p style="margin:20px 0 0;text-align:right;font-size:15px;font-weight:bold;color:#1a1a1a;">Toplam: ${escapeHtml(amountText(totalAmount))}</p>`
}

/** Key/value info box used for tracking, bank and cargo details. */
export function renderInfoBox(
  rows: ReadonlyArray<readonly [label: string, value: string | undefined | null]>,
  style = 'margin-bottom:24px;',
): string {
  const body = rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    .map(
      ([label, value]) => `<tr>
        <td style="font-size:14px;color:#555;padding:6px 12px 6px 0;vertical-align:top;white-space:nowrap;"><strong>${escapeHtml(label)}:</strong></td>
        <td style="font-size:14px;color:#333;padding:6px 0;word-break:break-word;">${escapeHtml(String(value))}</td>
      </tr>`,
    )
    .join('')
  if (!body) return ''
  return `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:6px;padding:16px;${style}"><tbody>${body}</tbody></table>`
}

export function greeting(name: string): string {
  return `<p style="margin:0 0 24px;font-size:15px;color:#555;">Merhaba ${escapeHtml(name)},</p>`
}

export function heading(title: string): string {
  return `<h2 style="margin:0 0 16px;font-size:20px;color:#1a1a1a;">${escapeHtml(title)}</h2>`
}

export function paragraph(
  html: string,
  style = 'margin:0 0 24px;font-size:15px;color:#555;',
): string {
  return `<p style="${style}">${html}</p>`
}

/** Shared, table-based wrapper for consistent and mobile-friendly emails. */
export function layout(title: string, body: string): string {
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
      .email-items img { width: 44px !important; height: 44px !important; }
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
