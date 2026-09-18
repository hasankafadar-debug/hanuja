import { describe, expect, it } from 'vitest'
import {
  DISTANCE_SALES_DOCUMENT_VERSION,
  PRE_INFORMATION_DOCUMENT_VERSION,
  buildPublicLegalDocumentContext,
  hashLegalDocumentHtml,
  renderLegalDocuments,
  type LegalContractContext,
} from '../../api/lib/legal-documents'

/**
 * Gerçek sipariş benzeri bağlam: kupon + %3 Havale/EFT indirimi + iki satır
 * (farklı sevk süreleri, renk/malzeme/ölçü/SKU/barkod). Tutarlar checkout
 * formülüyle tutarlıdır: gross − kupon − eft + kargo = toplam.
 */
function buildSampleOrderContext(overrides: Partial<LegalContractContext> = {}): LegalContractContext {
  const base = buildPublicLegalDocumentContext()
  return {
    ...base,
    items: [
      {
        productId: 'prod-1',
        productName: "Angolo 2'li Orta Sehpa",
        variantName: null,
        quantity: 1,
        unitPrice: 48700,
        lineTotal: 48700,
        sellerId: 'seller-1',
        sellerStoreName: 'Woodform',
        sku: 'ANG-2LI',
        barcode: '8690000000017',
        colors: ['Siyah', 'Beyaz'],
        material: 'Meşe',
        dimensionWidthCm: 100,
        dimensionLengthCm: 30,
        dimensionHeightCm: 45,
        promisedFulfillmentDays: 12,
      },
      {
        productId: 'prod-2',
        productName: 'Rattan Konsol',
        variantName: 'Renk: Naturel',
        quantity: 1,
        unitPrice: 10000,
        lineTotal: 10000,
        sellerId: 'seller-1',
        sellerStoreName: 'Woodform',
        sku: null,
        barcode: null,
        colors: [],
        material: null,
        dimensionWidthCm: null,
        dimensionLengthCm: null,
        dimensionHeightCm: null,
        promisedFulfillmentDays: 5,
      },
    ],
    orderNumber: '26050001',
    paymentMethod: 'eft',
    subtotalAmount: 58700,
    couponCode: 'HOSGELDIN',
    couponDiscountAmount: 1000,
    eftDiscountAmount: 1761,
    eftDiscountRatePercent: 3,
    shippingAmount: 0,
    taxAmount: 9783.33,
    totalAmount: 55939,
    ...overrides,
  }
}

describe('legal documents', () => {
  it('renders versioned distance sales and pre-information documents with marketplace role language', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    expect(bundle.distanceSalesVersion).toBe(DISTANCE_SALES_DOCUMENT_VERSION)
    expect(bundle.preInformationVersion).toBe(PRE_INFORMATION_DOCUMENT_VERSION)

    expect(bundle.distanceSalesHtml).toContain('Belge Sürümü')
    expect(bundle.distanceSalesHtml).toContain('elektronik ticaret aracı hizmet sağlayıcı')
    expect(bundle.distanceSalesHtml).toContain('Satıcı Sorumlulukları')
    expect(bundle.distanceSalesHtml).toContain('Alıcı Beyan ve Sorumlulukları')
    expect(bundle.distanceSalesHtml).toContain('Uyuşmazlık')

    expect(bundle.preInformationHtml).toContain('Teknik Sipariş Adımları')
    expect(bundle.preInformationHtml).toContain('Platformun Rolü ve Sorumluluk Sınırı')
  })

  it('embeds the active document versions in both order snapshots', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    expect(bundle.distanceSalesHtml).toContain(
      `<strong>Belge Sürümü:</strong> ${DISTANCE_SALES_DOCUMENT_VERSION}`,
    )
    expect(bundle.preInformationHtml).toContain(
      `<strong>Belge Sürümü:</strong> ${PRE_INFORMATION_DOCUMENT_VERSION}`,
    )
    expect(bundle.distanceSalesVersion).toBe('distance-sales-2026-09-18-v4')
    expect(bundle.preInformationVersion).toBe('pre-information-2026-09-18-v4')
    expect(bundle.distanceSalesVersion).not.toBe('distance-sales-2026-09-03-v3')
    expect(bundle.preInformationVersion).not.toBe('pre-information-2026-09-03-v3')
  })

  it('shows VAT-inclusive prices without a separate calculated VAT line', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('KDV Dahil')
      expect(html).toContain('Toplam Sipariş Bedeli')
      expect(html).not.toContain('Hesaplanan KDV')
      expect(html).not.toContain('ürün bedelleri, KDV, kargo')
    }
  })

  it('uses the 2026 return shipping posture and does not keep old electronics exceptions', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())
    const combinedHtml = `${bundle.distanceSalesHtml}\n${bundle.preInformationHtml}`

    expect(combinedHtml).toContain('01.01.2026')
    expect(combinedHtml).toContain('tüketici iade masraflarından sorumlu tutulamaz')
    expect(combinedHtml).not.toContain('telefon, akıllı saat, tablet ve bilgisayar')
    expect(combinedHtml).not.toContain('iade kargo müşteriye aittir')
  })

  it('states the personalized-goods withdrawal exception without limiting defective-goods remedies', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara ilişkin')
      expect(html).toContain("Mesafeli Sözleşmeler Yönetmeliği'ndeki cayma hakkı istisnaları")
      expect(html).toContain('Ürün bu nitelikteyse ve mevzuattaki koşullar oluşmuşsa cayma hakkı kullanılamayabilir')
      expect(html).toContain('Ayıplı veya sözleşmeye aykırı ürünlere ilişkin tüketicinin mevzuattan doğan')
      expect(html).toContain('yasal hakları saklıdır')
      expect(html).toContain('cayma hakkı istisnası bu hakları ortadan kaldırmaz')
    }
  })

  it('keeps a general (flag-free) clause for buyer-requested customization proven by correspondence', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('mevcut bir üründe değişiklik, ölçü/renk/malzeme uyarlaması veya özel üretim')
      expect(html).toContain('yazışma ve sipariş')
      expect(html).toContain('30 günlük azami teslim süresi istisnası uygulanabilir')
    }
  })

  it('hashes rendered HTML deterministically for legal acceptance evidence', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())
    const firstHash = hashLegalDocumentHtml(bundle.distanceSalesHtml)
    const secondHash = hashLegalDocumentHtml(bundle.distanceSalesHtml)

    expect(firstHash).toBe(secondHash)
    expect(firstHash).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('legal documents — order summary discounts', () => {
  it('sample context reconciles: subtotal − coupon − eft + shipping = total', () => {
    const context = buildSampleOrderContext()
    expect(
      context.subtotalAmount -
        context.couponDiscountAmount -
        context.eftDiscountAmount +
        context.shippingAmount,
    ).toBe(context.totalAmount)
  })

  it('renders coupon and Havale/EFT discount rows so the total is explained', () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('58.700,00 TL (KDV Dahil)')
      expect(html).toContain('Kupon İndirimi (HOSGELDIN)')
      expect(html).toContain('-1.000,00 TL')
      expect(html).toContain('Havale / EFT İndirimi (%3)')
      expect(html).toContain('-1.761,00 TL')
      expect(html).toContain('55.939,00 TL (KDV Dahil)')
    }
  })

  it('omits discount rows when no discount applies', () => {
    const bundle = renderLegalDocuments(
      buildSampleOrderContext({
        paymentMethod: 'card',
        couponCode: null,
        couponDiscountAmount: 0,
        eftDiscountAmount: 0,
        eftDiscountRatePercent: 0,
        totalAmount: 58700,
      }),
    )

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).not.toContain('Kupon İndirimi')
      expect(html).not.toContain('Havale / EFT İndirimi')
    }
  })

  it('formats a fractional EFT rate with the Turkish decimal separator and escapes the coupon code', () => {
    const bundle = renderLegalDocuments(
      buildSampleOrderContext({
        couponCode: 'A<B>&"C"',
        eftDiscountRatePercent: 2.5,
      }),
    )

    expect(bundle.distanceSalesHtml).toContain('Havale / EFT İndirimi (%2,5)')
    expect(bundle.distanceSalesHtml).toContain('Kupon İndirimi (A&lt;B&gt;&amp;&quot;C&quot;)')
    expect(bundle.distanceSalesHtml).not.toContain('A<B>')
  })
})

describe('legal documents — essential characteristics snapshot', () => {
  it('prints colour, material, dimensions, SKU and barcode under the product name', () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('Ürün / Hizmet ve Temel Nitelikleri')
      expect(html).toContain('Renk: Siyah - Beyaz')
      expect(html).toContain('Materyal: Meşe')
      expect(html).toContain('En: 100 cm · Boy: 30 cm · Yükseklik: 45 cm')
      expect(html).toContain('SKU: ANG-2LI')
      expect(html).toContain('Barkod: 8690000000017')
      expect(html).toContain('<small>(Renk: Naturel)</small>')
    }
  })

  it('does not render an empty characteristics block for a line without attributes', () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())
    const occurrences = bundle.distanceSalesHtml.split('class="item-attributes"').length - 1

    expect(occurrences).toBe(1)
  })

  it('describes the snapshot intent in the pre-information product section', () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())

    expect(bundle.preInformationHtml).toContain(
      'anındaki temel nitelikleri (seçilen varyant, renk, malzeme, ölçü, ürün kodu ve sevk süresi)',
    )
  })
})

describe('legal documents — fulfillment commitment', () => {
  it("prints each line's promised dispatch time and the longest one as the order commitment", () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('<th>Sevk Süresi</th>')
      expect(html).toContain('<td>12 iş günü</td>')
      expect(html).toContain('<td>5 iş günü</td>')
      expect(html).toContain('<strong>Taahhüt Edilen Sevk Süresi</strong>')
      expect(html).toContain('<span>12 iş günü</span>')
      expect(html).not.toContain('<span>5 iş günü</span>')
      expect(html).toContain('en uzun sevk süresi esas alınır')
    }
  })

  it('states the 30-day statutory cap with the made-to-order exception instead of a blanket promise', () => {
    const bundle = renderLegalDocuments(buildSampleOrderContext())

    for (const html of [bundle.distanceSalesHtml, bundle.preInformationHtml]) {
      expect(html).toContain('mal satışlarında teslimat süresi her hâlükârda mevzuattaki azami süre olan')
      expect(html).toContain('30 günü geçemez')
      expect(html).toContain('sipariş özetinde belirtilen sevk süresi')
      expect(html).not.toContain('en geç 30 gün içinde tamamlanır')
    }
  })

  it('falls back to a product-page reference on the public sample documents', () => {
    const bundle = renderLegalDocuments(buildPublicLegalDocumentContext())

    expect(bundle.distanceSalesHtml).toContain('<span>ürün sayfasında belirtilen sevk süresi</span>')
    expect(bundle.distanceSalesHtml).toContain('<td>-</td>')
  })
})
