import { PLATFORM_LEGAL_INFO } from './platform-info'

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
}

export interface LegalContractContext {
  buyer: LegalBuyerSnapshot
  sellers: LegalSellerSnapshot[]
  items: LegalOrderItemSnapshot[]
  orderNumber?: string
  orderDate: Date
  paymentMethod: 'card' | 'eft'
  subtotalAmount: number
  shippingAmount: number
  taxAmount: number
  totalAmount: number
}

export interface LegalDocumentBundle {
  distanceSalesHtml: string
  preInformationHtml: string
  buyerSnapshot: LegalBuyerSnapshot
  sellerSnapshot: LegalSellerSnapshot[]
  platformSnapshot: typeof PLATFORM_LEGAL_INFO
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
      .muted {
        color: #4b5563;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 6px 0;
        border-bottom: 1px solid #e5e7eb;
      }
      .summary-row:last-child {
        border-bottom: 0;
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
          <p><strong>Ticaret Unvanı:</strong> ${escapeHtml(seller.companyName)}</p>
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
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.productName)}${item.variantName ? ` <small>(${escapeHtml(item.variantName)})</small>` : ''}</td>
          <td>${escapeHtml(item.sellerStoreName)}</td>
          <td>${item.quantity}</td>
          <td>${formatCurrency(item.unitPrice)} (KDV Dahil)</td>
          <td>${formatCurrency(item.lineTotal)} (KDV Dahil)</td>
        </tr>
      `,
    )
    .join('')

  return `
    <table>
      <thead>
        <tr>
          <th>Ürün</th>
          <th>Satıcı</th>
          <th>Adet</th>
          <th>Birim Fiyat</th>
          <th>Satır Toplamı</th>
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
      <p><strong>ETBIS / Marka:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.brandDisplay)}</p>
      <p><strong>Şirket Unvanı:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.companyNameDisplay)}</p>
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
      <p><strong>Sipariş Tarihi:</strong> ${formatDate(context.orderDate)}</p>
      <p><strong>Ödeme Yöntemi:</strong> ${escapeHtml(paymentMethodLabel(context.paymentMethod))}</p>
      <div class="summary-row">
        <strong>Ürünler Toplamı</strong>
        <span>${formatCurrency(context.subtotalAmount)} (KDV Dahil)</span>
      </div>
      <div class="summary-row">
        <strong>Kargo</strong>
        <span>${formatCurrency(context.shippingAmount)}</span>
      </div>
      <div class="summary-row">
        <strong>Toplam Sipariş Bedeli</strong>
        <span>${formatCurrency(context.totalAmount)} (KDV Dahil)</span>
      </div>
      <p class="muted">Teslimat, ürün sayfasında veya sipariş sırasında daha kısa bir süre belirtilmedikçe en geç 30 gün içinde tamamlanır.</p>
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
        <p>
          İşbu Mesafeli Satış Sözleşmesi, aşağıda bilgileri yer alan Alıcı ile siparişe konu ürün veya
          ürünlerin satıcısı arasında elektronik ortamda kurulmuştur. ${escapeHtml(PLATFORM_LEGAL_INFO.brandDisplay)},
          6563 sayılı Kanun kapsamında elektronik ticaret aracı hizmet sağlayıcısı olarak ödeme ve sipariş
          akışına aracılık eder.
        </p>

        <h2>1. Taraflar</h2>
        <h3>Alıcı Bilgileri</h3>
        ${renderBuyerSection(context.buyer)}

        <h3>Satıcı Bilgileri</h3>
        ${renderSellerList(context.sellers)}

        <h3>Aracı Hizmet Sağlayıcı Bilgileri</h3>
        ${renderPlatformSection()}

        <h2>2. Sözleşme Konusu Sipariş</h2>
        ${renderItemsTable(context.items)}
        ${renderOrderSummary(context)}

        <h2>3. Sipariş ve Ödeme Koşulları</h2>
        <p>
          Alıcı, sipariş vermeden önce ürünlerin temel niteliklerini, satıcı bilgisini, toplam bedeli,
          teslimat koşullarını ve ödeme seçeneğini okuyup onayladığını kabul eder.
        </p>
        <p>
          Sipariş bedeli, seçilen ödeme yöntemine göre platform üzerinden tahsil edilir. Alıcının bedeli
          ödemesi, ilgili satıcıya karşı ödeme yükümlülüğünün ifası anlamına gelir.
        </p>

        <h2>4. Teslimat ve İfa</h2>
        <p>
          Sipariş konusu ürünler, Alıcının bildirdiği teslimat adresine, mevzuatta belirtilen süreler ve
          ürün sayfasında ilan edilen koşullar çerçevesinde gönderilir.
        </p>
        <p>
          Teslimat ve faturalandırma sorumluluğu ilgili satıcıya aittir. Birden fazla satıcıdan verilen
          siparişlerde ürünler farklı paketler halinde sevk edilebilir.
        </p>

        <h2>5. Cayma Hakkı</h2>
        <p>
          Alıcı, mal satışlarında, ürünün kendisine veya gösterdiği üçüncü kişiye tesliminden itibaren 14 gün
          içinde herhangi bir gerekçe göstermeksizin cayma hakkını kullanabilir.
        </p>
        <p>
          Cayma bildirimi, sipariş detay ekranı, destek kanalları veya ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}
          adresi üzerinden iletilebilir. İade süreci, ilgili satıcının yönetimindeki ürün kabul ve inceleme
          adımlarıyla tamamlanır.
        </p>

        <h2>6. Cayma Hakkının İstisnaları</h2>
        <ul>
          <li>Alıcının istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan ürünler</li>
          <li>Hijyen veya sağlık nedeniyle iadesi uygun olmayan ve ambalajı açılmış ürünler</li>
          <li>Çabuk bozulabilen veya son kullanma tarihi geçme ihtimali olan ürünler</li>
          <li>Elektronik ortamda anında ifa edilen dijital içerikler</li>
          <li>Mesafeli Sözleşmeler Yönetmeliği uyarınca cayma hakkı dışında kalan diğer ürün ve hizmetler</li>
        </ul>

        <h2>7. Sorumluluk ve Başvuru Yolları</h2>
        <p>
          Ürünün ayıbı, teslimi, faturalandırılması ve satış sonrası yükümlülükleri ilgili satıcının
          sorumluluğundadır. Platform, mevzuattan doğan aracı hizmet sağlayıcı yükümlülükleri kapsamında destek
          ve kayıt saklama hizmeti sunar.
        </p>
        <p>
          Uyuşmazlıklarda Alıcı, başvurusunu parasal sınırlar dahilinde yetkili Tüketici Hakem Heyeti'ne veya
          Tüketici Mahkemesi'ne yapabilir.
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
        <p>
          Bu form, sipariş öncesinde Alıcının; satıcı, aracı hizmet sağlayıcı, ödeme, teslimat, cayma hakkı ve
          başvuru yollarına ilişkin temel konularda bilgilendirilmesi amacıyla hazırlanmıştır.
        </p>

        <h2>1. Alıcı Bilgileri</h2>
        ${renderBuyerSection(context.buyer)}

        <h2>2. Satıcı Bilgileri</h2>
        ${renderSellerList(context.sellers)}

        <h2>3. Aracı Hizmet Sağlayıcı Bilgileri</h2>
        ${renderPlatformSection()}

        <h2>4. Sipariş Özeti</h2>
        ${renderItemsTable(context.items)}
        ${renderOrderSummary(context)}

        <h2>5. Teslimat ve Ödeme Bilgilendirmesi</h2>
        <p>
          Sipariş konusu ürünler, seçilen teslimat adresine gönderilir. Sipariş bedeli ${escapeHtml(paymentMethodLabel(context.paymentMethod))}
          ile tahsil edilir veya ödeme beklemeye alınır.
        </p>
        <p>
          Birden fazla satıcıdan oluşan siparişlerde sevkiyatlar ayrı kargolar halinde yapılabilir. Teslimat
          süreleri ürün detayında ve sipariş sürecinde gösterilen bilgilerle birlikte değerlendirilir.
        </p>

        <h2>6. Cayma Hakkı ve İade Süreci</h2>
        <p>
          Alıcı, teslimden itibaren 14 gün içinde cayma hakkını kullanabilir. Cayma bildiriminin ardından ürün,
          ilgili satıcıya yönlendirilir ve iade koşulları ürün niteliğine göre incelenir.
        </p>
        <p>
          İstisna kapsamındaki ürünler ve kullanılmış, zarar görmüş veya yeniden satışa uygun olmayan ürünler
          için mevzuat ve ilan edilen satıcı koşulları uygulanır.
        </p>

        <h2>7. İletişim ve Başvuru Kanalları</h2>
        <p>
          Siparişle ilgili talepler için ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)} e-posta adresi ve
          ${escapeHtml(PLATFORM_LEGAL_INFO.phoneDisplay)} telefon numarası kullanılabilir.
        </p>
        <p>
          Alıcı, uyuşmazlıklarda parasal sınırlar dahilinde yetkili Tüketici Hakem Heyeti'ne veya Tüketici
          Mahkemesi'ne başvurabilir.
        </p>
      </body>
    </html>
  `
}

export function renderLegalDocuments(context: LegalContractContext): LegalDocumentBundle {
  return {
    distanceSalesHtml: renderDistanceSales(context),
    preInformationHtml: renderPreInformation(context),
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
      deliveryAddress: '[Teslimat adresi ödeme adımında otomatik oluşturulur]',
      billingAddress: '[Fatura adresi ödeme adımında otomatik oluşturulur]',
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
      },
    ],
    orderNumber: 'Önizleme',
    orderDate: new Date(),
    paymentMethod: 'card',
    subtotalAmount: 0,
    shippingAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
  }
}
