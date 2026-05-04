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

function renderSellerList(sellers: LegalSellerSnapshot[]) {
  return sellers
    .map(
      (seller) => `
        <section>
          <h4>${escapeHtml(seller.storeName)}</h4>
          <p><strong>Ticaret Unvanı:</strong> ${escapeHtml(seller.companyName)}</p>
          <p><strong>Adres:</strong> ${escapeHtml(seller.legalAddress)}, ${escapeHtml(seller.district)} / ${escapeHtml(seller.city)} ${escapeHtml(seller.postalCode)}</p>
          <p><strong>Vergi Dairesi / No:</strong> ${escapeHtml(seller.taxOffice)} / ${escapeHtml(seller.taxNumber)}</p>
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
          <td>${formatCurrency(item.unitPrice)}</td>
          <td>${formatCurrency(item.lineTotal)}</td>
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
          <th>Ara Toplam</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `
}

function renderBuyerSection(buyer: LegalBuyerSnapshot) {
  return `
    <p><strong>Ad Soyad:</strong> ${escapeHtml(buyer.fullName)}</p>
    <p><strong>E-posta:</strong> ${escapeHtml(buyer.email)}</p>
    <p><strong>Telefon:</strong> ${escapeHtml(buyer.phone)}</p>
    <p><strong>Teslimat Adresi:</strong> ${escapeHtml(buyer.deliveryAddress)}</p>
    <p><strong>Fatura Adresi:</strong> ${escapeHtml(buyer.billingAddress)}</p>
  `
}

function renderPlatformSection() {
  return `
    <p><strong>Unvan:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.companyNameDisplay)}</p>
    <p><strong>Adres:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.address)}</p>
    <p><strong>Vergi Dairesi / No:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.taxOffice)} / ${escapeHtml(PLATFORM_LEGAL_INFO.taxNumber)}</p>
    <p><strong>MERSİS:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.mersis)}</p>
    <p><strong>Telefon:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.phoneDisplay)}</p>
    <p><strong>Destek E-postası:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}</p>
    <p><strong>Alan Adı:</strong> ${escapeHtml(PLATFORM_LEGAL_INFO.domain)}</p>
  `
}

function renderOrderSummary(context: LegalContractContext) {
  return `
    <p><strong>Sipariş Numarası:</strong> ${escapeHtml(context.orderNumber ?? 'Önizleme')}</p>
    <p><strong>Sipariş Tarihi:</strong> ${formatDate(context.orderDate)}</p>
    <p><strong>Ödeme Yöntemi:</strong> ${escapeHtml(paymentMethodLabel(context.paymentMethod))}</p>
    <p><strong>Ürün Toplamı:</strong> ${formatCurrency(context.subtotalAmount)}</p>
    <p><strong>Kargo:</strong> ${formatCurrency(context.shippingAmount)}</p>
    <p><strong>Toplam Sipariş Bedeli:</strong> ${formatCurrency(context.totalAmount)}</p>
    <p><strong>Teslimat Süresi:</strong> En geç 30 gün içinde teslim edilir.</p>
  `
}

function renderDistanceSales(context: LegalContractContext) {
  return `
    <h1>Mesafeli Satış Sözleşmesi</h1>
    <p>İşbu Mesafeli Satış Sözleşmesi, Alıcı ile Satıcı arasında elektronik ortamda kurulmuştur.</p>

    <h2>1. Taraflar</h2>
    <h3>Alıcı Bilgileri</h3>
    ${renderBuyerSection(context.buyer)}

    <h3>Satıcı Bilgileri</h3>
    ${renderSellerList(context.sellers)}

    <h3>Elektronik Ticaret Aracı Hizmet Sağlayıcı Bilgileri</h3>
    ${renderPlatformSection()}

    <h2>2. Siparişe Konu Ürünler ve Bedel</h2>
    ${renderItemsTable(context.items)}
    ${renderOrderSummary(context)}

    <h2>3. Genel Hükümler</h2>
    <p>Alıcı, siparişe konu ürünlerin temel niteliklerini, satış fiyatını, ödeme şeklini ve teslimata ilişkin tüm ön bilgileri okuyup bilgi sahibi olduğunu kabul eder.</p>
    <p>Satıcı, sipariş konusu ürünleri mevzuata ve ürün sayfasındaki açıklamalara uygun şekilde teslim etmekle yükümlüdür.</p>
    <p>Platform, 6563 sayılı Kanun ve ilgili mevzuat kapsamında elektronik ticaret aracı hizmet sağlayıcı olarak aracılık hizmeti sunar; ürünün satışı ve ifası bakımından satıcı sorumludur.</p>
    <p>Ürün bedeli, satıcı adına platform tarafından tahsil edilir. Alıcının bedeli platforma ödemesiyle satıcıya ödeme yükümlülüğü ifa edilmiş sayılır.</p>

    <h2>4. Teslimat ve İfa</h2>
    <p>Ürünler, Alıcının sipariş sırasında bildirdiği teslimat adresine en geç 30 gün içinde teslim edilir.</p>
    <p>Teslimat masrafı sipariş özetinde gösterildiği şekilde toplam bedele dahildir.</p>

    <h2>5. Cayma Hakkı</h2>
    <p>Alıcı, ürünün tesliminden itibaren 14 gün içinde herhangi bir gerekçe göstermeksizin cayma hakkını kullanabilir.</p>
    <p>Cayma bildirimi destek kanalları üzerinden veya hesap sayfasındaki sipariş detay ekranı üzerinden yapılabilir.</p>
    <p>Cayma hakkı kapsamındaki iadelerde ürün, bildirimi takip eden 14 gün içinde satıcıya gönderilmelidir.</p>

    <h2>6. Cayma Hakkının Kullanılamadığı Haller</h2>
    <ul>
      <li>Alıcının istekleri doğrultusunda kişiselleştirilen ürünler</li>
      <li>Hijyen ve sağlık açısından iadesi uygun olmayan, koruyucu unsurları açılmış ürünler</li>
      <li>Çabuk bozulabilen veya son kullanma tarihi geçebilecek ürünler</li>
      <li>Elektronik ortamda anında ifa edilen dijital içerikler</li>
      <li>Mevzuat gereği cayma hakkı tanınmayan diğer ürün ve hizmetler</li>
    </ul>

    <h2>7. Kişisel Veriler</h2>
    <p>Satıcı, Alıcıya ait kişisel verileri yalnızca siparişin ifası amacıyla ve mevzuata uygun biçimde işler. Platform dışında iletişim kurulamaz.</p>

    <h2>8. Uyuşmazlıkların Çözümü</h2>
    <p>İşbu Mesafeli Satış Sözleşmesi'nden doğabilecek ihtilaflarda İzmir Mahkemeleri ve İcra Daireleri yetkilidir.</p>
  `
}

function renderPreInformation(context: LegalContractContext) {
  return `
    <h1>Ön Bilgilendirme Formu</h1>
    <p>Bu form, sipariş kurulmadan önce Alıcının satış işlemine ilişkin temel hususlarda bilgilendirilmesi amacıyla düzenlenmiştir.</p>

    <h2>1. Taraflar</h2>
    <h3>Alıcı Bilgileri</h3>
    ${renderBuyerSection(context.buyer)}

    <h3>Satıcı Bilgileri</h3>
    ${renderSellerList(context.sellers)}

    <h3>Elektronik Ticaret Aracı Hizmet Sağlayıcı Bilgileri</h3>
    ${renderPlatformSection()}

    <h2>2. Sipariş Özeti</h2>
    ${renderItemsTable(context.items)}
    ${renderOrderSummary(context)}

    <h2>3. Teslimat ve İade Bilgilendirmesi</h2>
    <p>Ürünler, aksi ayrıca belirtilmedikçe Alıcının teslimat adresine gönderilir. Teslimat süresi en geç 30 gündür.</p>
    <p>Alıcı, teslimden itibaren 14 gün içinde cayma hakkını kullanabilir. İade sürecine ilişkin detaylar sipariş ekranında ve destek kanallarında yer alır.</p>

    <h2>4. Ödeme ve Tahsilat</h2>
    <p>Toplam sipariş bedeli, seçilen ödeme yöntemiyle platform üzerinden tahsil edilir. Satıcı, kendi ürünlerine ilişkin faturalandırmadan sorumludur.</p>

    <h2>5. Şikayet ve Başvuru Kanalları</h2>
    <p>Alıcı; sipariş, teslimat, iade ve diğer taleplerini <strong>${escapeHtml(PLATFORM_LEGAL_INFO.supportEmail)}</strong> adresi ve <strong>${escapeHtml(PLATFORM_LEGAL_INFO.phoneDisplay)}</strong> numarası üzerinden iletebilir.</p>

    <h2>6. Uyuşmazlıkların Çözümü</h2>
    <p>İşbu Ön Bilgilendirme Formu'ndan doğabilecek ihtilaflarda İzmir Mahkemeleri ve İcra Daireleri yetkilidir.</p>
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
    totalAmount: 0,
  }
}
