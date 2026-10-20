import { customerLegalHtml } from './customer-legal-content'
import { createHash } from 'node:crypto'
import { formatProductColors, formatProductDimensions } from '../domain/product-characteristics'
import { PLATFORM_LEGAL_INFO } from './platform-info'

// v4 (2026-09-18): kupon / Havale-EFT indirim satırları, sipariş anındaki ürün
// temel nitelikleri (renk, malzeme, ölçü, SKU/barkod), ürün bazlı sevk süresi
// ve 30 günlük azami teslim süresinin özel üretim istisnası eklendi.
export const DISTANCE_SALES_DOCUMENT_VERSION = 'distance-sales-2026-10-20-v7'
export const PRE_INFORMATION_DOCUMENT_VERSION = 'pre-information-2026-10-20-v7'

export interface LegalBuyerSnapshot {
  fullName: string
  email: string
  phone: string
  deliveryAddress: string
  billingAddress: string
}

export interface LegalSellerSnapshot {
  sellerId: string
  storeName: string
  companyName: string
  legalAddress: string
  district: string
  city: string
  postalCode: string
  taxOffice: string
  taxNumber: string
  mersis: string
  phone: string
}

export interface LegalOrderItemSnapshot {
  characteristics?: Array<{ label: string; value: string }>
  productId: string
  productName: string
  variantName: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
  sellerId: string
  sellerStoreName: string
  /** Sipariş anındaki temel nitelikler — ürün sayfasına atıf yerine belgeye sabitlenir. */
  sku: string | null
  barcode: string | null
  /** Renk 1 → Renk 2 sırasıyla. */
  colors: string[]
  material: string | null
  dimensionWidthCm: number | null
  dimensionLengthCm: number | null
  dimensionHeightCm: number | null
  /** Satıcının ürün bazında taahhüt ettiği sevk süresi (iş günü). */
  promisedFulfillmentDays: number
}

export interface LegalContractContext {
  buyer: LegalBuyerSnapshot
  sellers: LegalSellerSnapshot[]
  items: LegalOrderItemSnapshot[]
  orderNumber?: string
  orderDate: Date
  paymentMethod: 'card' | 'eft'
  cardPaymentFlow?: 'checkout_form'
  /** Internal evidence hash; never rendered into either accepted document. */
  checkoutSourceFingerprint?: string
  subtotalAmount: number
  /** Kupon indirimi (platform veya satıcı kuponu); 0 ise satır basılmaz. */
  couponCode: string | null
  couponDiscountAmount: number
  /** Havale / EFT kanal indirimi; 0 ise satır basılmaz. Yüzde sipariş anındaki oran (ör. 3). */
  eftDiscountAmount: number
  eftDiscountRatePercent: number
  shippingAmount: number
  taxAmount: number
  totalAmount: number
  installmentCount?: number | null
  installmentDifferenceAmount?: number | null
}

export interface LegalDocumentBundle {
  distanceSalesHtml: string
  preInformationHtml: string
  distanceSalesVersion: string
  preInformationVersion: string
  buyerSnapshot: LegalBuyerSnapshot
  sellerSnapshot: LegalSellerSnapshot[]
  platformSnapshot: typeof PLATFORM_LEGAL_INFO
}

export function hashLegalDocumentHtml(html: string) {
  return createHash('sha256').update(html, 'utf8').digest('hex')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatCurrency(value: number) {
  return `${value.toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} TL`
}

function formatDate(value: Date) {
  return value.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatPercent(value: number) {
  return `%${value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`
}

function formatFulfillmentDays(days: number) {
  return `${days} iş günü`
}

/**
 * Siparişin sevk taahhüdü: birden fazla ürün varsa en uzun sevk süresi esas
 * alınır. Hiçbir satırda süre yoksa (public örnek belge) ürün sayfasına atıf.
 */
function resolvePromisedFulfillmentDays(items: LegalOrderItemSnapshot[]) {
  return items.reduce((max, item) => Math.max(max, item.promisedFulfillmentDays), 0)
}

function formatOrderFulfillmentCommitment(items: LegalOrderItemSnapshot[]) {
  const days = resolvePromisedFulfillmentDays(items)
  return days > 0 ? formatFulfillmentDays(days) : 'ürün sayfasında belirtilen sevk süresi'
}

function formatItemCharacteristics(item: LegalOrderItemSnapshot) {
  const colors = formatProductColors(item.colors)
  const dimensions = formatProductDimensions({
    widthCm: item.dimensionWidthCm,
    lengthCm: item.dimensionLengthCm,
    heightCm: item.dimensionHeightCm,
  })
  return [
    colors ? `Renk: ${colors}` : null,
    item.material ? `Materyal: ${item.material}` : null,
    dimensions,
    item.sku ? `SKU: ${item.sku}` : null,
    item.barcode ? `Barkod: ${item.barcode}` : null,
    ...(item.characteristics ?? []).map((row) => `${row.label}: ${row.value}`),
  ].filter((part): part is string => part !== null)
}

function paymentMethodLabel(paymentMethod: 'card' | 'eft') {
  return paymentMethod === 'card' ? 'Banka Kartı / Kredi Kartı' : 'Havale / EFT'
}

function renderDocumentStyles() {
  return `
    <style>
      body {
        font-family: Arial, sans-serif;
        color: #111827;
        line-height: 1.55;
        font-size: 14px;
      }
      h1, h2, h3, h4 {
        color: #111827;
        margin: 0 0 12px;
      }
      h1 { font-size: 26px; }
      h2 { font-size: 18px; margin-top: 28px; }
      h3 { font-size: 15px; margin-top: 18px; }
      h4 { font-size: 14px; margin-top: 14px; }
      p, li { margin: 0 0 10px; }
      ul, ol { padding-left: 22px; }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 16px 0;
      }
      th, td {
        border: 1px solid #d1d5db;
        padding: 10px;
        text-align: left;
        vertical-align: top;
      }
      th {
        background: #f3f4f6;
        font-weight: 700;
      }
      .section {
        border: 1px solid #e5e7eb;
        padding: 16px;
        margin: 16px 0;
      }
      .muted { color: #4b5563; }
      .item-attributes {
        color: #4b5563;
        font-size: 12px;
        margin-top: 4px;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 0;
        border-bottom: 1px solid #e5e7eb;
      }
      .summary-row:last-child { border-bottom: 0; }
      .notice {
        background: #f8fafc;
        border-left: 4px solid #64748b;
        padding: 12px 14px;
        margin: 16px 0;
      }
    </style>
  `
}

function renderItemsTable(items: LegalOrderItemSnapshot[]) {
  const rows = items
    .map((item) => {
      const characteristics = formatItemCharacteristics(item)
      const characteristicsHtml =
        characteristics.length > 0
          ? `<div class="item-attributes">${characteristics.map(escapeHtml).join(' · ')}</div>`
          : ''
      return `
        <tr>
          <td>
            ${escapeHtml(item.productName)}${item.variantName ? ` <small>(${escapeHtml(item.variantName)})</small>` : ''}
            ${characteristicsHtml}
          </td>
          <td>${escapeHtml(item.sellerStoreName)}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unitPrice)} (KDV Dahil)</td>
          <td>${formatCurrency(item.lineTotal)} (KDV Dahil)</td>
          <td>${item.promisedFulfillmentDays > 0 ? formatFulfillmentDays(item.promisedFulfillmentDays) : '-'}</td>
        </tr>
      `
    })
    .join('')

  return `
    <table>
      <thead>
        <tr>
          <th>Ürün / Hizmet ve Temel Nitelikleri</th>
          <th>Tasarımcı / Marka</th>
          <th>Adet</th>
          <th>Birim Fiyat</th>
          <th>Satır Toplamı</th>
          <th>Sevk Süresi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderBuyerSection(buyer: LegalBuyerSnapshot) {
  return `
    <div class="section">
      <p><strong>Ad Soyad:</strong> ${escapeHtml(buyer.fullName)}</p>
      <p><strong>E-posta:</strong> ${escapeHtml(buyer.email)}</p>
      <p><strong>Telefon:</strong> ${escapeHtml(buyer.phone)}</p>
      <p><strong>Teslimat Adresi:</strong> ${escapeHtml(buyer.deliveryAddress)}</p>
      <p><strong>Fatura Adresi:</strong> ${escapeHtml(buyer.billingAddress)}</p>
    </div>
  `
}

function renderOrderSummary(context: LegalContractContext) {
  return `
    <div class="section">
      <p><strong>Sipariş Numarası:</strong> ${escapeHtml(context.orderNumber ?? 'Önizleme')}</p>
      <p><strong>Sipariş / Sözleşme Tarihi:</strong> ${formatDate(context.orderDate)}</p>
      <p><strong>Ödeme Yöntemi:</strong> ${escapeHtml(paymentMethodLabel(context.paymentMethod))}</p>
      <div class="summary-row">
        <strong>Ürünler Toplamı</strong>
        <span>${formatCurrency(context.subtotalAmount)} (KDV Dahil)</span>
      </div>
      ${renderDiscountRows(context)}
      <div class="summary-row"><strong>Taksit Farkı</strong><span>${context.cardPaymentFlow === 'checkout_form' ? 'Kart ve taksit seçimine göre iyzico ödeme alanında gösterilir' : context.installmentDifferenceAmount == null ? 'Taksit seçimi uygulanmıyor' : formatCurrency(context.installmentDifferenceAmount)}</span></div>
      ${context.installmentCount ? '<p><strong>Taksit Sayısı:</strong> ' + context.installmentCount + '</p>' : ''}

      <div class="summary-row">
        <strong>Kargo</strong>
        <span>${formatCurrency(context.shippingAmount)}</span>
      </div>
      <div class="summary-row">
        <strong>${context.cardPaymentFlow === 'checkout_form' ? 'Peşin Sepet Toplamı' : 'Toplam Sipariş Bedeli'}</strong>
        <span>${formatCurrency(context.totalAmount)} (KDV Dahil)</span>
      </div>
      ${context.cardPaymentFlow === 'checkout_form' ? '<p class="notice">Kart ve taksit seçimi iyzico ödeme alanında yapılır. Taksit farkını alıcı öder. Kesin tahsilat toplamı ve taksit planı ödeme onayından önce iyzico alanında gösterilir. Bu belge peşin sepet tutarını ve bu açıklamayı içerir; seçilen taksit ve doğrulanan tahsilat bilgileri ayrıca kaydedilir.</p>' : ''}
      <div class="summary-row">
        <strong>Taahhüt Edilen Sevk Süresi</strong>
        <span>${escapeHtml(formatOrderFulfillmentCommitment(context.items))}</span>
      </div>
      <p class="muted">
        Siparişe konu ürünler, ödemenin onaylanmasından itibaren yukarıda belirtilen sevk süresi içinde kargoya
        verilir; birden fazla ürün bulunan siparişlerde en uzun sevk süresi esas alınır ve süre iş günü olarak
        hesaplanır. Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin
        sözleşmeler hariç olmak üzere, mal satışlarında teslimat süresi her hâlükârda mevzuattaki azami süre olan
        30 günü geçemez.
      </p>
    </div>
  `
}

/**
 * Müşterinin ödediği tutarı düşüren indirimler ayrı satırlarda gösterilir; aksi
 * hâlde "Ürünler Toplamı + Kargo" ile "Toplam Sipariş Bedeli" arasındaki fark
 * belgede açıklanmaz. Sıfır olan indirim satırı basılmaz.
 */
function renderDiscountRows(context: LegalContractContext) {
  const rows: string[] = []

  if (context.couponDiscountAmount > 0) {
    const label = context.couponCode
      ? `Kupon İndirimi (${escapeHtml(context.couponCode)})`
      : 'Kupon İndirimi'
    rows.push(`
      <div class="summary-row">
        <strong>${label}</strong>
        <span>-${formatCurrency(context.couponDiscountAmount)}</span>
      </div>
    `)
  }

  if (context.eftDiscountAmount > 0) {
    const label =
      context.eftDiscountRatePercent > 0
        ? `Havale / EFT İndirimi (${formatPercent(context.eftDiscountRatePercent)})`
        : 'Havale / EFT İndirimi'
    rows.push(`
      <div class="summary-row">
        <strong>${label}</strong>
        <span>-${formatCurrency(context.eftDiscountAmount)}</span>
      </div>
    `)
  }

  return rows.join('')
}

/**
 * Mesafeli Sözleşmeler Yönetmeliği md. 15 cayma hakkı istisnaları. Sözleşme/ön bilgilendirme
 * belgeleri ve sipariş e-postaları aynı listeyi kullanır; metin yalnız burada değiştirilir.
 */
export const RIGHT_OF_WITHDRAWAL_EXCEPTIONS: readonly string[] = [
  'Fiyatı finansal piyasalardaki dalgalanmalara bağlı olarak değişen ve satıcı veya sağlayıcının kontrolünde olmayan ürün ve hizmetler.',
  'Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin sözleşmeler.',
  'Çabuk bozulabilen veya son kullanma tarihi geçebilecek ürünler.',
  'Tesliminden sonra ambalaj, bant, mühür veya koruyucu unsurları açılmış olan ve sağlık/hijyen açısından iadesi uygun olmayan ürünler.',
  'Tesliminden sonra başka ürünlerle karışan ve doğası gereği ayrıştırılması mümkün olmayan ürünler.',
  'Ambalajı açılmış kitap, dijital içerik ve bilgisayar sarf malzemeleri.',
  'Abonelik sözleşmesi kapsamında sağlananlar dışında gazete ve dergi gibi süreli yayınlar.',
  'Belirli bir tarihte veya dönemde yapılması gereken konaklama, taşıma, araç kiralama, yiyecek-içecek tedariki ve boş zamanın değerlendirilmesine ilişkin hizmetler.',
  'Elektronik ortamda anında ifa edilen hizmetler veya tüketiciye anında teslim edilen gayrimaddi mallar.',
  'Cayma hakkı süresi sona ermeden önce tüketicinin onayı ile ifasına başlanan hizmetler.',
  'Mevzuatta cayma hakkı dışında bırakılan diğer ürün ve hizmetler.',
]

function renderCustomerContract(context: LegalContractContext, id: '05' | '06', version: string) {
  let content = customerLegalHtml(id)
  const dynamic =
    renderBuyerSection(context.buyer) +
    renderItemsTable(context.items) +
    renderOrderSummary(context) +
    '<p><strong>Cayma istisnası:</strong> Bu standart sipariş için özel üretim istisnası uygulanmamaktadır. Ayıplı mal hakları saklıdır.</p>'
  const heading =
    id === '05'
      ? '<h2>Madde 3 – Sözleşme Konusu Sipariş</h2>'
      : '<h2>2. Sözleşme Konusu Sipariş</h2>'
  content = content.replace(heading, heading + dynamic)
  return (
    '<!doctype html><html lang="tr"><head><meta charset="utf-8" />' +
    renderDocumentStyles() +
    '</head><body>' +
    '<p><strong>Belge Sürümü:</strong> ' +
    escapeHtml(version) +
    '</p>' +
    content +
    '</body></html>'
  )
}
export function renderLegalDocuments(context: LegalContractContext): LegalDocumentBundle {
  const difference = context.installmentDifferenceAmount
  if (difference != null) {
    if (!Number.isFinite(difference) || difference < 0) throw new Error('Geçersiz taksit farkı')
    if (
      difference > 0 &&
      (!Number.isInteger(context.installmentCount) || (context.installmentCount ?? 0) < 2)
    )
      throw new Error('Taksit farkı için doğrulanmış taksit seçimi gerekli')
    const expected =
      context.subtotalAmount -
      context.couponDiscountAmount -
      context.eftDiscountAmount +
      context.shippingAmount +
      difference
    if (Math.round(expected * 100) !== Math.round(context.totalAmount * 100))
      throw new Error('Taksit farkı ve nihai toplam uyuşmuyor')
  }
  return {
    distanceSalesHtml: renderCustomerContract(context, '05', DISTANCE_SALES_DOCUMENT_VERSION),
    preInformationHtml: renderCustomerContract(context, '06', PRE_INFORMATION_DOCUMENT_VERSION),
    distanceSalesVersion: DISTANCE_SALES_DOCUMENT_VERSION,
    preInformationVersion: PRE_INFORMATION_DOCUMENT_VERSION,
    buyerSnapshot: context.buyer,
    sellerSnapshot: [
      {
        sellerId: 'hanuja',
        storeName: 'Hanuja',
        companyName: PLATFORM_LEGAL_INFO.companyLegalName,
        legalAddress: PLATFORM_LEGAL_INFO.address,
        district: PLATFORM_LEGAL_INFO.district,
        city: PLATFORM_LEGAL_INFO.city,
        postalCode: '',
        taxOffice: PLATFORM_LEGAL_INFO.taxOffice,
        taxNumber: PLATFORM_LEGAL_INFO.taxNumber,
        mersis: PLATFORM_LEGAL_INFO.mersis,
        phone: PLATFORM_LEGAL_INFO.phoneDisplay,
      },
    ],
    platformSnapshot: PLATFORM_LEGAL_INFO,
  }
}

export function buildPublicLegalDocumentContext(): LegalContractContext {
  return {
    buyer: {
      fullName: '[Alıcı Ad Soyad]',
      email: '[alici@ornek.com]',
      phone: '[05XX XXX XX XX]',
      deliveryAddress: '[Teslimat adresi ödeme adımında otomatik oluşur]',
      billingAddress: '[Fatura adresi ödeme adımında otomatik oluşur]',
    },
    sellers: [
      {
        sellerId: 'sample-seller',
        storeName: '[Tasarımcı / Marka Adı]',
        companyName: '[Satıcı Ticaret Unvanı]',
        legalAddress: '[Satıcı Açık Adresi]',
        district: '[İlçe]',
        city: '[Şehir]',
        postalCode: '[Posta Kodu]',
        taxOffice: '[Vergi Dairesi]',
        taxNumber: '[Vergi Numarası]',
        mersis: '[MERSİS Numarası]',
        phone: '[Satıcı Telefonu]',
      },
    ],
    items: [
      {
        productId: 'sample-product',
        productName: '[Siparişe Konu Ürün]',
        variantName: null,
        quantity: 1,
        unitPrice: 0,
        lineTotal: 0,
        sellerId: 'sample-seller',
        sellerStoreName: '[Tasarımcı / Marka Adı]',
        sku: null,
        barcode: null,
        colors: [],
        material: null,
        dimensionWidthCm: null,
        dimensionLengthCm: null,
        dimensionHeightCm: null,
        promisedFulfillmentDays: 0,
      },
    ],
    orderNumber: 'Önizleme',
    orderDate: new Date(),
    paymentMethod: 'card',
    subtotalAmount: 0,
    couponCode: null,
    couponDiscountAmount: 0,
    eftDiscountAmount: 0,
    eftDiscountRatePercent: 0,
    shippingAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
  }
}
