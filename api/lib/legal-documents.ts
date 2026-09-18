import { createHash } from 'node:crypto'
import {
  formatProductColors,
  formatProductDimensions,
} from '../domain/product-characteristics'
import { PLATFORM_LEGAL_INFO } from './platform-info'

// v4 (2026-09-18): kupon / Havale-EFT indirim satırları, sipariş anındaki ürün
// temel nitelikleri (renk, malzeme, ölçü, SKU/barkod), ürün bazlı sevk süresi
// ve 30 günlük azami teslim süresinin özel üretim istisnası eklendi.
export const DISTANCE_SALES_DOCUMENT_VERSION = 'distance-sales-2026-09-18-v4'
export const PRE_INFORMATION_DOCUMENT_VERSION = 'pre-information-2026-09-18-v4'

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

function renderSellerList(sellers: LegalSellerSnapshot[]) {
  return sellers
    .map(
      (seller) => `
        <section class="section">
          <h4>${escapeHtml(seller.storeName)}</h4>
          <p><strong>Satıcı / Sağlayıcı Ticaret Unvanı:</strong> ${escapeHtml(seller.companyName)}</p>
          <p><strong>Adres:</strong> ${escapeHtml(seller.legalAddress)}, ${escapeHtml(seller.district)} / ${escapeHtml(seller.city)} ${escapeHtml(seller.postalCode)}</p>
          <p><strong>Vergi Dairesi / Vergi No:</strong> ${escapeHtml(seller.taxOffice)} / ${escapeHtml(seller.taxNumber)}</p>
          <p><strong>MERSİS:</strong> ${escapeHtml(seller.mersis)}</p>
          <p><strong>Telefon:</strong> ${escapeHtml(seller.phone)}</p>
        </section>
      `,
    )
    .join('')
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
          <th>Satıcı</th>
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

function renderPlatformSection() {
  return `
    <div class="section">
      <p><strong>Platform / Marka:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.brandDisplay)}</p>
      <p><strong>Aracı Hizmet Sağlayıcı Şirket Unvanı:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.companyNameDisplay)}</p>
      <p><strong>Adres:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.address)}</p>
      <p><strong>Vergi Dairesi / Vergi No:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.taxOffice)} / ${escapeHtml(PLATFORM_LEGAL_INFO.taxNumber)}</p>
      <p><strong>MERSİS:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.mersis)}</p>
      <p><strong>Telefon:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.phoneDisplay)}</p>
      <p><strong>Destek E-postası:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}</p>
      <p><strong>Alan Adı:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.domain)}</p>
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
      <div class="summary-row">
        <strong>Kargo</strong>
        <span>${formatCurrency(context.shippingAmount)}</span>
      </div>
      <div class="summary-row">
        <strong>Toplam Sipariş Bedeli</strong>
        <span>${formatCurrency(context.totalAmount)} (KDV Dahil)</span>
      </div>
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

function renderRightOfWithdrawalExceptions() {
  return `
    <ul>
      <li>Fiyatı finansal piyasalardaki dalgalanmalara bağlı olarak değişen ve satıcı veya sağlayıcının kontrolünde olmayan ürün ve hizmetler.</li>
      <li>Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin sözleşmeler.</li>
      <li>Çabuk bozulabilen veya son kullanma tarihi geçebilecek ürünler.</li>
      <li>Tesliminden sonra ambalaj, bant, mühür veya koruyucu unsurları açılmış olan ve sağlık/hijyen açısından iadesi uygun olmayan ürünler.</li>
      <li>Tesliminden sonra başka ürünlerle karışan ve doğası gereği ayrıştırılması mümkün olmayan ürünler.</li>
      <li>Ambalajı açılmış kitap, dijital içerik ve bilgisayar sarf malzemeleri.</li>
      <li>Abonelik sözleşmesi kapsamında sağlananlar dışında gazete ve dergi gibi süreli yayınlar.</li>
      <li>Belirli bir tarihte veya dönemde yapılması gereken konaklama, taşıma, araç kiralama, yiyecek-içecek tedariki ve boş zamanın değerlendirilmesine ilişkin hizmetler.</li>
      <li>Elektronik ortamda anında ifa edilen hizmetler veya tüketiciye anında teslim edilen gayrimaddi mallar.</li>
      <li>Cayma hakkı süresi sona ermeden önce tüketicinin onayı ile ifasına başlanan hizmetler.</li>
      <li>Mevzuatta cayma hakkı dışında bırakılan diğer ürün ve hizmetler.</li>
    </ul>
  `
}

function renderPersonalizedGoodsWithdrawalNotice() {
  return `
    <div class="notice">
      <h3>Tüketicinin İstekleri veya Kişisel İhtiyaçları Doğrultusunda Hazırlanan Mallar</h3>
      <p>
        Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin
        sözleşmeler, Mesafeli Sözleşmeler Yönetmeliği'ndeki cayma hakkı istisnaları arasında yer alır.
        Ürün bu nitelikteyse ve mevzuattaki koşullar oluşmuşsa cayma hakkı kullanılamayabilir.
      </p>
      <p>
        Alıcı'nın Satıcı'dan mevcut bir üründe değişiklik, ölçü/renk/malzeme uyarlaması veya özel üretim
        talep etmesi hâlinde, bu talep ve Satıcı'nın kabulü platform üzerindeki yazışma ve sipariş
        kayıtlarıyla ispat edilir; bu nitelikteki ürünler tüketicinin istekleri veya kişisel ihtiyaçları
        doğrultusunda hazırlanan mal sayılır ve mevzuattaki koşullar oluşmuşsa cayma hakkı istisnası ile
        30 günlük azami teslim süresi istisnası uygulanabilir.
      </p>
      <p>
        Ayıplı veya sözleşmeye aykırı ürünlere ilişkin tüketicinin mevzuattan doğan seçimlik ve diğer
        yasal hakları saklıdır; cayma hakkı istisnası bu hakları ortadan kaldırmaz.
      </p>
    </div>
  `
}

function renderPlatformRoleNotice() {
  return `
    <div class="notice">
      <p>
        Hanuja, çok satıcılı pazar yeri modeliyle çalışan elektronik ticaret aracı hizmet sağlayıcıdır.
        Ürünün satıcısı, ürün satırında ve satıcı bilgilerinde gösterilen ilgili satıcıdır. Hanuja ürünün
        üreticisi, ithalatçısı, bayisi veya doğrudan satıcısı değildir; ancak mevzuattan doğan aracı hizmet
        sağlayıcı yükümlülükleri, ön bilgilendirme, kayıt saklama, cayma bildirimi alma/iletme, destek ve
        uygulanabilir bedel iadesi sorumlulukları saklıdır.
      </p>
    </div>
  `
}

function renderDistanceSales(context: LegalContractContext) {
  return `
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <title>Mesafeli Satış Sözleşmesi</title>
        ${renderDocumentStyles()}
      </head>
      <body>
        <h1>Mesafeli Satış Sözleşmesi</h1>
        <p><strong>Belge Sürümü:</strong> ${escapeHtml(DISTANCE_SALES_DOCUMENT_VERSION)}</p>
        <p>
          İşbu Mesafeli Satış Sözleşmesi, aşağıda bilgileri bulunan Alıcı/Tüketici ile siparişe konu
          ürünlerin ilgili Satıcı/Sağlayıcıları arasında, Hanuja platformu üzerinden elektronik ortamda
          kurulmuştur.
        </p>
        ${renderPlatformRoleNotice()}

        <h2>1. Taraflar ve Sıfatlar</h2>
        <h3>Alıcı / Tüketici Bilgileri</h3>
        ${renderBuyerSection(context.buyer)}

        <h3>Satıcı / Sağlayıcı Bilgileri</h3>
        ${renderSellerList(context.sellers)}

        <h3>Elektronik Ticaret Aracı Hizmet Sağlayıcı Bilgileri</h3>
        ${renderPlatformSection()}

        <h2>2. Sözleşme Konusu Sipariş</h2>
        <p>
          Sözleşmenin konusu; Alıcı'nın elektronik ortamda sipariş verdiği, temel nitelikleri ürün sayfasında
          gösterilen ve aşağıda listelenen ürünlerin satışı, teslimi, ödeme koşulları, cayma hakkı, iade,
          uyuşmazlık ve taraf sorumluluklarının belirlenmesidir.
        </p>
        ${renderItemsTable(context.items)}
        ${renderOrderSummary(context)}

        <h2>3. Siparişin Kurulması ve Elektronik Kayıtlar</h2>
        <p>
          Alıcı; ürün, satıcı, fiyat, kargo, vergi, ödeme, teslimat, cayma hakkı ve başvuru yollarına ilişkin
          ön bilgileri okuyup elektronik ortamda onayladıktan sonra ödeme yükümlülüğü doğuran siparişini verir.
          Alıcı, sipariş öncesinde sepetini, adresini, ödeme yöntemini ve ürün adetlerini kontrol edebildiğini
          ve veri giriş hatalarını ödeme öncesinde düzeltebildiğini kabul eder.
        </p>
        <p>
          Hanuja, siparişe ilişkin sözleşme ve ön bilgilendirme metnini sipariş bazında elektronik ortamda
          saklar ve Alıcı'nın sipariş detayından erişimine sunar. Bu kayıtlar uyuşmazlık, denetim, muhasebe ve
          mevzuata uyum amaçlarıyla saklanabilir.
        </p>

        <h2>4. Satıcı Sorumlulukları</h2>
        <p>
          Ürünlerin temel nitelikleri, mevzuata uygunluğu, stok ve fiyat bilgisinin doğruluğu, ürün görselleri,
          açıklamalar, garanti/servis bilgileri, yasaklı veya kısıtlı ürün yayınlanmaması, ürün faturası,
          teslimatın yerine getirilmesi, ayıplı/hasarlı/yanlış/eksik ürün iddiaları ve satış sonrası ürün
          yükümlülükleri ilgili Satıcı'nın sorumluluğundadır.
        </p>
        <p>
          Satıcı, sipariş konusu ürünü mevzuata ve ilan edilen bilgilere uygun şekilde, hasarsız ve eksiksiz
          olarak göndermek; yasal belgeleri düzenlemek; iade, değişim, ayıp, garanti ve uyuşmazlık süreçlerinde
          gerekli bilgi ve delilleri sunmakla yükümlüdür.
        </p>

        <h2>5. Alıcı Beyan ve Sorumlulukları</h2>
        <p>
          Alıcı; üyelik, teslimat, fatura ve iletişim bilgilerinin doğru ve güncel olduğunu, ödeme aracını
          hukuka uygun ve yetkili şekilde kullandığını, teslim aldığı ürünü olağan gözden geçirme sınırını
          aşmayacak şekilde muhafaza edeceğini kabul eder.
        </p>
        <p>
          Hileli iade, sahte hasar bildirimi, kupon/indirim suistimali, sahte yorum, çoklu hesapla manipülasyon,
          platform dışı ödeme veya iletişim yönlendirmesi, yanıltıcı delil sunma ve benzeri kötüye kullanımlar
          yasaktır. Bu hallerde Hanuja hesabı kısıtlayabilir, siparişi veya talebi incelemeye alabilir ve yasal
          haklarını saklı tutar.
        </p>

        <h2>6. Ödeme, Fatura ve Tahsilat</h2>
        <p>
          Sipariş bedeli seçilen ödeme yöntemine göre Hanuja platformu üzerinden tahsil edilir veya EFT/Havale
          için ödeme beklemeye alınır. Alıcı'nın bedeli platform üzerinden ödemesi, ilgili satıcıya karşı ödeme
          yükümlülüğünün ifası amacıyla yapılır.
        </p>
        <p>
          Ürün satış faturası ilgili Satıcı tarafından düzenlenir. Hanuja'nın satıcılara sunduğu pazar yeri,
          tahsilat, operasyon, reklam veya benzeri hizmetler için düzenleyebileceği hizmet faturaları ürün satış
          faturasından ayrıdır.
        </p>

        <h2>7. Teslimat, Kargo, Kayıp ve Hasar</h2>
        <p>
          Ürünler, Alıcı'nın bildirdiği teslimat adresine gönderilir. Yanlış, eksik veya güncel olmayan adres
          bilgisinden doğan gecikme, teslim edilememe, ek maliyet ve iletişim problemlerinden Alıcı sorumludur.
        </p>
        <p>
          Satıcı, ürünü sipariş özetinde belirtilen sevk süresi içinde kargoya vermek ve, tüketicinin istekleri
          veya kişisel ihtiyaçları doğrultusunda hazırlanan mallar hariç olmak üzere, her hâlde mevzuattaki azami
          süreye (30 gün) uygun şekilde teslim etmekle yükümlüdür. Malın tüketiciye veya tüketicinin belirlediği
          üçüncü kişiye teslimine kadar oluşan kayıp
          ve hasar, mevzuatın öngördüğü çerçevede Satıcı'nın sorumluluğundadır. Alıcı'nın Satıcı'nın belirlediği
          taşıyıcı dışında başka bir taşıyıcı talep ettiği hallerde, ilgili taşıyıcıya teslimden sonraki kayıp ve
          hasar riski mevzuata uygun şekilde Alıcı'ya geçebilir.
        </p>

        <h2>8. Cayma Hakkı</h2>
        <p>
          Alıcı, mal satışlarında ürünün kendisine veya belirlediği üçüncü kişiye tesliminden itibaren 14 gün
          içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin cayma hakkını kullanabilir. Tek
          sipariş konusu olup ayrı ayrı teslim edilen ürünlerde süre son ürünün teslimiyle başlar. Alıcı,
          ürün teslim edilmeden önce de cayma hakkını kullanabilir.
        </p>
        <p>
          Cayma bildirimi, sipariş detay ekranı, destek kanalları veya ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}
          üzerinden Hanuja'ya ya da ilgili Satıcı'ya iletilebilir. Hanuja, platform üzerinden alınan cayma ve
          iade taleplerini ilgili Satıcı'ya iletir ve süreç kayıtlarını saklar.
        </p>

        <h2>9. Cayma Sonrası İade ve Kargo Masrafları</h2>
        <p>
          Cayma hakkı kapsamında iade edilecek ürün, Satıcı'nın belirttiği iade taşıyıcısı ve talimatları
          doğrultusunda gönderilmelidir. 01.01.2026 itibarıyla yürürlükteki rejim uyarınca, Satıcı'nın iade için
          belirttiği taşıyıcıyla yapılan iadelerde tüketici iade masraflarından sorumlu tutulamaz; Satıcı'nın
          ön bilgilendirmede iade taşıyıcısı belirtmediği durumda tüketiciden iade masrafı talep edilemez.
          İade taşıyıcısının tüketicinin bulunduğu yerde şubesi yoksa Satıcı, mevzuata uygun şekilde ilave masraf
          talep etmeksizin ürünün alınmasını sağlamalıdır.
        </p>
        <p>
          İade edilen ürünün kullanılmasından, hasar görmesinden, aksesuar/parça eksik dönmesinden, ambalaj ve
          koruyucu unsurların ürün niteliğine aykırı biçimde açılmasından veya mevzuata aykırı iade talebinden
          doğan uyuşmazlıklar delillerle değerlendirilir.
        </p>

        <h2>10. Cayma Hakkının İstisnaları</h2>
        <p>Aşağıdaki hallerde ve mevzuatta sayılan diğer durumlarda cayma hakkı kullanılamayabilir:</p>
        ${renderPersonalizedGoodsWithdrawalNotice()}
        ${renderRightOfWithdrawalExceptions()}

        <h2>11. Ayıplı, Hasarlı, Yanlış veya Eksik Ürün</h2>
        <p>
          Alıcı; ayıplı, hasarlı, yanlış veya eksik ürün iddialarında sipariş detayından veya destek kanalından
          başvuru yapabilir. Fotoğraf, video, kargo tutanağı, ürün ambalajı, fatura ve benzeri deliller talep
          edilebilir. Ürünün ayıbı, yanlış gönderimi, eksik parçası veya ilan edilen niteliklere aykırılığı
          ilgili Satıcı'nın sorumluluğundadır.
        </p>

        <h2>12. Uyuşmazlık, İnceleme ve Başvuru Yolları</h2>
        <p>
          Hanuja, iade veya uyuşmazlık süreçlerinde taraflardan bilgi ve delil isteyebilir, ilgili siparişe ait
          satıcı hakedişini inceleme süresince bloke edebilir ve kayıtları saklayabilir. Platform incelemesi,
          tarafların mevzuattan doğan haklarını ortadan kaldırmaz.
        </p>
        <p>
          Alıcı, uyuşmazlıklarda parasal sınırlar dahilinde yetkili Tüketici Hakem Heyeti'ne veya Tüketici
          Mahkemesi'ne başvurabilir. Mevzuatın arabuluculuk veya başka bir ön başvuru şartı öngördüğü hallerde
          ilgili usul uygulanır.
        </p>

        <h2>13. Delil, Kayıt ve Saklama</h2>
        <p>
          Alıcı'nın sözleşme ve ön bilgilendirme onayı, belge sürümü, sözleşme içeriği, sipariş bilgileri, IP,
          kullanıcı aracı, oturum ve zaman damgası gibi kayıtlar, uyuşmazlık ve mevzuata uyum amaçlarıyla
          saklanabilir. Bu kayıtlar, siparişin kurulduğu anda Alıcı'ya sunulan metinlerin ispatı için kullanılır.
        </p>
      </body>
    </html>
  `
}

function renderPreInformation(context: LegalContractContext) {
  return `
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charSet="utf-8" />
        <title>Ön Bilgilendirme Formu</title>
        ${renderDocumentStyles()}
      </head>
      <body>
        <h1>Ön Bilgilendirme Formu</h1>
        <p><strong>Belge Sürümü:</strong> ${escapeHtml(PRE_INFORMATION_DOCUMENT_VERSION)}</p>
        <p>
          Bu form, siparişin kurulmasından önce Alıcı'nın satıcı, aracı hizmet sağlayıcı, ürün, bedel, ödeme,
          teslimat, cayma hakkı, iade, şikayet ve başvuru yolları hakkında açık ve anlaşılır biçimde
          bilgilendirilmesi amacıyla hazırlanmıştır.
        </p>
        ${renderPlatformRoleNotice()}

        <h2>1. Alıcı Bilgileri</h2>
        ${renderBuyerSection(context.buyer)}

        <h2>2. Satıcı / Sağlayıcı Bilgileri</h2>
        ${renderSellerList(context.sellers)}

        <h2>3. Aracı Hizmet Sağlayıcı Bilgileri</h2>
        ${renderPlatformSection()}

        <h2>4. Ürünlerin Temel Nitelikleri ve Sipariş Özeti</h2>
        <p>
          Ürünlerin temel nitelikleri, marka/model/ölçü/renk/varyant gibi ürün sayfasında gösterilen bilgiler,
          stok ve satış açıklamaları ilgili Satıcı tarafından sağlanır. Siparişe konu ürünler ve sipariş
          anındaki temel nitelikleri (seçilen varyant, renk, malzeme, ölçü, ürün kodu ve sevk süresi) aşağıda
          yer alır.
        </p>
        ${renderItemsTable(context.items)}
        ${renderOrderSummary(context)}

        <h2>5. Ödeme, Ek Masraflar ve Teknik Sipariş Adımları</h2>
        <p>
          Sipariş bedeli ${escapeHtml(paymentMethodLabel(context.paymentMethod))} yöntemiyle tahsil edilir veya
          ödeme beklemeye alınır. Toplam bedel; ürün bedelleri, kargo ve sipariş sırasında gösterilen
          indirim/ek ücretleri içerir. Alıcı, ödeme öncesinde sepeti, adresi, fatura bilgisini, ödeme yöntemini
          ve ürün adetlerini kontrol edip düzeltebilir.
        </p>
        <p>
          Siparişi tamamla veya ödeme adımı, ödeme yükümlülüğü doğuran sipariş anlamına gelir. Sözleşme ve bu
          ön bilgilendirme formu sipariş bazında elektronik ortamda saklanır ve sipariş detay ekranından
          erişilebilir.
        </p>

        <h2>6. Teslimat Bilgilendirmesi</h2>
        <p>
          Ürünler seçilen teslimat adresine gönderilir. Birden fazla satıcıdan oluşan siparişlerde ürünler farklı
          paketler ve farklı taşıyıcılarla sevk edilebilir. Satıcı, ürünü sipariş özetinde belirtilen sevk süresi
          içinde kargoya vermekten ve, tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan
          mallar hariç olmak üzere, teslimatın her hâlde mevzuattaki azami süreye (30 gün) uygun şekilde
          yapılmasından sorumludur.
        </p>
        <p>
          Teslimata kadar kayıp ve hasar riski, mevzuatın öngördüğü çerçevede Satıcı'ya aittir. Alıcı'nın yanlış
          veya eksik adres bildirmesi, teslim almaktan kaçınması ya da Satıcı'nın belirlediği taşıyıcı dışında
          taşıyıcı talep etmesi halinde doğabilecek sonuçlar ayrıca değerlendirilir.
        </p>

        <h2>7. Cayma Hakkı ve Kullanım Usulü</h2>
        <p>
          Alıcı, ürün tesliminden itibaren 14 gün içinde gerekçe göstermeksizin cayma hakkını kullanabilir.
          Cayma bildirimi sipariş detay ekranı, destek kanalları veya ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}
          üzerinden iletilebilir. Bildirimin süresi içinde yöneltilmesi yeterlidir.
        </p>
        <p>
          Cayma sonrasında ürün Satıcı'nın bildirdiği iade talimatına uygun gönderilir. 01.01.2026 itibarıyla
          yürürlükteki rejim uyarınca, Satıcı'nın belirttiği iade taşıyıcısıyla yapılan iadelerde tüketici iade
          masrafından sorumlu tutulamaz; iade taşıyıcısı belirtilmemişse tüketiciden iade masrafı talep edilemez.
        </p>

        <h2>8. Cayma Hakkının İstisnaları</h2>
        <p>Ürün niteliği veya mevzuat gereği aşağıdaki sözleşmelerde cayma hakkı kullanılamayabilir:</p>
        ${renderPersonalizedGoodsWithdrawalNotice()}
        ${renderRightOfWithdrawalExceptions()}

        <h2>9. Ayıplı Ürün, İade ve Uyuşmazlık Kanalları</h2>
        <p>
          Ayıplı, hasarlı, yanlış, eksik veya ürün açıklamasına aykırı teslim iddialarında Alıcı sipariş
          detayından veya destek kanallarından başvuru yapabilir. Hanuja taraflardan delil isteyebilir ve
          uyuşmazlığı kayıt altına alabilir. Ürün kaynaklı ayıp, açıklama, fatura, garanti, servis ve teslimat
          yükümlülükleri ilgili Satıcı'ya aittir.
        </p>

        <h2>10. Platformun Rolü ve Sorumluluk Sınırı</h2>
        <p>
          Hanuja, ürünün doğrudan satıcısı değil, çok satıcılı pazar yeri altyapısını sağlayan aracı hizmet
          sağlayıcıdır. Hanuja'nın mevzuattan doğan ön bilgilendirme, teyit, ispat, kayıt saklama, cayma
          bildirimi alma/iletme, destek ve uygulanabilir bedel iadesi yükümlülükleri saklıdır. Bunun dışında
          ürünün içeriği, mevzuata uygunluğu, stok, fatura, garanti, servis, teslimat ve ayıp sorumluluğu ilgili
          Satıcı'ya aittir.
        </p>

        <h2>11. Başvuru Yolları</h2>
        <p>
          Siparişle ilgili talepler için ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)} e-posta adresi ve
          ${escapeHtml(PLATFORM_LEGAL_INFO.phoneDisplay)} telefon numarası kullanılabilir. Alıcı, uyuşmazlıklarda
          parasal sınırlar dahilinde yetkili Tüketici Hakem Heyeti'ne veya Tüketici Mahkemesi'ne başvurabilir.
          Mevzuatın arabuluculuk veya başka bir ön şart öngördüğü hallerde ilgili usul uygulanır.
        </p>
      </body>
    </html>
  `
}

export function renderLegalDocuments(context: LegalContractContext): LegalDocumentBundle {
  return {
    distanceSalesHtml: renderDistanceSales(context),
    preInformationHtml: renderPreInformation(context),
    distanceSalesVersion: DISTANCE_SALES_DOCUMENT_VERSION,
    preInformationVersion: PRE_INFORMATION_DOCUMENT_VERSION,
    buyerSnapshot: context.buyer,
    sellerSnapshot: context.sellers,
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
        storeName: '[Mağaza Adı]',
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
        sellerStoreName: '[Mağaza Adı]',
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
