/**
 * 14 günlük cayma hakkı bloğu — sipariş e-postalarının altında gösterilir.
 *
 * İstisna listesi sözleşme/ön bilgilendirme belgeleriyle aynı kaynaktan gelir
 * (`RIGHT_OF_WITHDRAWAL_EXCEPTIONS`, api/lib/legal-documents.ts). Kategoriye göre
 * otomatik "iade edilemez" kararı verilmez; koşullar ürün niteliğiyle birlikte
 * değerlendirilir ve bu metin yalnız bilgilendirme amaçlıdır.
 */

import { RIGHT_OF_WITHDRAWAL_EXCEPTIONS } from '../legal-documents'
import { PLATFORM_LEGAL_INFO } from '../platform-info'
import { escapeHtml, isSafeHttpUrl } from './shared'

export const WITHDRAWAL_NOTICE_TITLE = 'Cayma Hakkınız (14 Gün)'

export const WITHDRAWAL_NOTICE_PARAGRAPHS: readonly string[] = [
  'Ürünün size veya belirlediğiniz kişiye tesliminden itibaren 14 gün içinde hiçbir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkınızı kullanabilirsiniz. Tek siparişte ayrı ayrı teslim edilen ürünlerde süre, son ürünün teslimiyle başlar; ürün teslim edilmeden önce de cayma hakkı kullanılabilir.',
  `Cayma hakkınızı sipariş detay sayfasındaki "İade Talebi Oluştur" adımından, destek kanallarımızdan veya ${PLATFORM_LEGAL_INFO.supportEmail} adresine yazarak kullanabilirsiniz. Satıcının anlaşmalı kargo firmasıyla yapılan iadelerde kargo ücreti size yansıtılmaz.`,
  'Aşağıdaki nitelikteki ürün ve hizmetlerde, mevzuattaki koşullar oluşmuşsa cayma hakkı kullanılamayabilir. Satıcıdan ölçü, renk, malzeme uyarlaması veya özel üretim talep ettiğiniz ürünler, tüketicinin istekleri doğrultusunda hazırlanan mal sayılır. Ayıplı veya sözleşmeye aykırı ürünlere ilişkin yasal haklarınız her durumda saklıdır.',
]

/**
 * E-posta altına eklenen bilgilendirme bloğu. 12px punto ve #555 renk: küçük ama
 * okunaklı; hiçbir satır 12px altına inmez.
 */
export function renderWithdrawalNotice(options: {
  distanceSalesUrl?: string | null
  preInformationUrl?: string | null
}): string {
  const links = [
    ['Ön Bilgilendirme Formu', options.preInformationUrl],
    ['Mesafeli Satış Sözleşmesi', options.distanceSalesUrl],
  ]
    .filter(([, url]) => isSafeHttpUrl(url))
    .map(
      ([label, url]) =>
        `<a href="${escapeHtml(String(url).trim())}" style="color:#135854;font-weight:600;">${escapeHtml(String(label))}</a>`,
    )
    .join(' · ')
  const paragraphs = WITHDRAWAL_NOTICE_PARAGRAPHS.map(
    (text) => `<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#555;">${escapeHtml(text)}</p>`,
  ).join('')
  const items = RIGHT_OF_WITHDRAWAL_EXCEPTIONS.map(
    (item) => `<li style="margin:0 0 4px;">${escapeHtml(item)}</li>`,
  ).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;border-top:1px solid #eeeeee;">
    <tr><td style="padding-top:16px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:bold;color:#1a1a1a;">${escapeHtml(WITHDRAWAL_NOTICE_TITLE)}</p>
      ${paragraphs}
      <ul style="margin:0 0 8px;padding-left:18px;font-size:12px;line-height:1.5;color:#555;">${items}</ul>
      ${links ? `<p style="margin:0;font-size:12px;line-height:1.5;color:#555;">Ayrıntılar: ${links}</p>` : ''}
    </td></tr>
  </table>`
}

export function renderWithdrawalNoticeText(options: {
  distanceSalesUrl?: string | null
  preInformationUrl?: string | null
}): string {
  const lines = [
    WITHDRAWAL_NOTICE_TITLE,
    ...WITHDRAWAL_NOTICE_PARAGRAPHS,
    ...RIGHT_OF_WITHDRAWAL_EXCEPTIONS.map((item) => `- ${item}`),
  ]
  if (isSafeHttpUrl(options.preInformationUrl))
    lines.push(`Ön Bilgilendirme Formu: ${options.preInformationUrl.trim()}`)
  if (isSafeHttpUrl(options.distanceSalesUrl))
    lines.push(`Mesafeli Satış Sözleşmesi: ${options.distanceSalesUrl.trim()}`)
  return lines.join('\n')
}
