import { describe, expect, it } from 'vitest'
import {
  customerOrderCancelledTemplate,
  deliveryConfirmedTemplate,
  invoiceUploadedTemplate,
  orderConfirmationTemplate,
  refundCompletedTemplate,
  returnCargoInfoReadyTemplate,
  returnDecisionTemplate,
  returnRequestTemplate,
  sellerOrderCancellationTemplate,
  shipmentNotificationTemplate,
} from '../../api/lib/email-templates'
import { RIGHT_OF_WITHDRAWAL_EXCEPTIONS } from '../../api/lib/legal-documents'
import {
  renderWithdrawalNotice,
  WITHDRAWAL_NOTICE_PARAGRAPHS,
} from '../../api/lib/email-templates/withdrawal-notice'

const line = {
  productName: 'Gea Berjer',
  variantName: 'Doğal keten',
  quantity: 2,
  unitPrice: '4.850 TL',
  lineTotal: '9.700 TL',
  imageUrl: 'https://media.hanuja.tr/products/gea.jpg',
}

const lineWithoutImage = {
  productName: 'Meşe Sehpa',
  variantName: null,
  quantity: 1,
  unitPrice: '1.200 TL',
  lineTotal: '1.200 TL',
  imageUrl: null,
}

const base = {
  customerName: 'Ayşe',
  orderNumber: '26050042',
  orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
}

describe('orderConfirmationTemplate (Siparişiniz Alındı)', () => {
  const contracts = {
    preInformationUrl:
      'https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/pre-information?goruntule=1',
    distanceSalesUrl:
      'https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/distance-sales?goruntule=1',
  }

  it('renders a confirmed card order with images, amount summary, contract links and the withdrawal notice', () => {
    const template = orderConfirmationTemplate({
      ...base,
      items: [line, lineWithoutImage],
      totalAmount: '10.999 TL',
      paymentMethod: 'card',
      paymentStatus: 'confirmed',
      summary: {
        subtotal: '10.900 TL',
        couponDiscount: '100 TL',
        couponCode: 'HOSGELDIN',
        shipping: '199 TL',
      },
      contracts,
    })

    expect(template.subject).toBe('Siparişiniz Alındı — #26050042')
    expect(template.html).toContain('ödeme alındı')
    expect(template.html).not.toContain('Ödeme Bekleniyor')
    expect(template.html).toContain('src="https://media.hanuja.tr/products/gea.jpg"')
    // Missing image renders an empty cell, never a broken <img>.
    expect(template.html.match(/<img /g)).toHaveLength(1)
    expect(template.html).toContain('Kupon İndirimi (HOSGELDIN)')
    expect(template.html).toContain('Kargo')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/pre-information?goruntule=1"')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/api/orders/order-1/documents/contracts/distance-sales?goruntule=1"')
    expect(template.html).toContain('Cayma Hakkınız (14 Gün)')
    for (const exception of RIGHT_OF_WITHDRAWAL_EXCEPTIONS) {
      expect(template.text).toContain(exception)
    }
    expect(template.text).toContain('Toplam: 10.999 TL')
    expect(template.text).toContain(contracts.preInformationUrl)
  })

  it('renders every bank account for a pending EFT order (array payload) and never a dash placeholder', () => {
    const template = orderConfirmationTemplate({
      ...base,
      items: [line],
      totalAmount: '9.700 TL',
      paymentMethod: 'eft',
      bankTransferInstructions: [
        { bankName: 'Örnek Bank', accountHolder: 'Hanuja A.Ş.', iban: 'TR11 0000 0000 0000 0000 0000 01', branchName: 'Merkez' },
        { bankName: 'İkinci Bank', accountHolder: 'Hanuja A.Ş.', iban: 'TR22 0000 0000 0000 0000 0000 02' },
      ],
    })

    expect(template.subject).toBe('Siparişiniz Alındı — Ödeme Bekleniyor — #26050042')
    expect(template.html).toContain('ödeme bekleniyor')
    expect(template.html).toContain('Örnek Bank')
    expect(template.html).toContain('İkinci Bank')
    expect(template.html).toContain('TR22 0000 0000 0000 0000 0000 02')
    expect(template.html).toContain('Açıklama / Referans')
    expect(template.html).toContain('26050042')
    expect(template.text).toContain('IBAN: TR11 0000 0000 0000 0000 0000 01')
  })

  it('escapes seller/customer controlled fields and drops unsafe links', () => {
    const template = orderConfirmationTemplate({
      ...base,
      customerName: '<img src=x onerror=alert(1)>',
      orderUrl: 'javascript:alert(1)',
      items: [{ ...line, productName: '<script>alert(1)</script>', imageUrl: 'javascript:alert(2)' }],
      totalAmount: '9.700 TL',
      paymentMethod: 'card',
      contracts: { preInformationUrl: 'javascript:alert(3)', distanceSalesUrl: 'https://www.hanuja.com.tr/x' },
    })

    expect(template.html).not.toContain('<script>')
    expect(template.html).not.toContain('<img src=x')
    expect(template.html).not.toMatch(/href="javascript:/i)
    expect(template.html).not.toMatch(/src="javascript:/i)
    expect(template.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('withdrawal notice block', () => {
  it('uses at least 12px text and links only safe contract URLs', () => {
    const html = renderWithdrawalNotice({ preInformationUrl: 'ftp://x', distanceSalesUrl: 'https://www.hanuja.com.tr/a' })
    const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12)
    expect(html).toContain('href="https://www.hanuja.com.tr/a"')
    expect(html).not.toContain('ftp://x')
    expect(WITHDRAWAL_NOTICE_PARAGRAPHS[0]).toContain('14 gün')
    expect(html).toContain('Tüketicinin istekleri veya kişisel ihtiyaçları doğrultusunda hazırlanan mallara')
  })
})

describe('shipmentNotificationTemplate', () => {
  it('shows only the shipped quantities, carrier label, tracking number and a safe tracking link', () => {
    const template = shipmentNotificationTemplate({
      ...base,
      items: [{ ...line, quantity: 1, lineTotal: '4.850 TL' }],
      trackingNumber: 'YK123456789',
      cargoCompany: 'Yurtiçi Kargo',
      trackingUrl: 'https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=YK123456789',
      sellerName: 'Atelier Noa',
    })

    expect(template.subject).toBe('Siparişiniz Kargoya Verildi — #26050042')
    expect(template.html).toContain('Gönderilen Adet')
    expect(template.html).toContain('YK123456789')
    expect(template.html).toContain('Kargomu Takip Et')
    expect(template.html).toContain('Atelier Noa')
    expect(template.text).toContain('Kargo takip: https://www.yurticikargo.com')
  })

  it('omits the tracking button when no verified carrier link exists', () => {
    const template = shipmentNotificationTemplate({
      ...base,
      items: [line],
      trackingNumber: 'PTT-1',
      cargoCompany: 'PTT Kargo',
      trackingUrl: null,
    })
    expect(template.html).not.toContain('Kargomu Takip Et')
    expect(template.html).toContain('PTT-1')
  })
})

describe('deliveryConfirmedTemplate', () => {
  it('distinguishes partial and full delivery, escapes names and lists confirmed lines', () => {
    const partial = deliveryConfirmedTemplate({
      ...base,
      customerName: '<b>Ayşe</b>',
      items: [line],
      partial: true,
      confirmedAt: '22 Eylül 2026',
    })
    expect(partial.subject).toBe('Siparişinizin Bir Kısmı Teslim Edildi — #26050042')
    expect(partial.html).toContain('Kalan ürünler için ayrıca')
    expect(partial.html).toContain('Teslim Adedi')
    expect(partial.html).toContain('22 Eylül 2026')
    expect(partial.html).toContain('&lt;b&gt;Ayşe&lt;/b&gt;')
    expect(partial.html).not.toContain('<b>Ayşe</b>')

    const full = deliveryConfirmedTemplate({ ...base, items: [line], partial: false })
    expect(full.subject).toBe('Siparişiniz Teslim Edilmiştir — #26050042')
    expect(full.html).toContain('14 gün içinde')
  })
})

describe('invoiceUploadedTemplate', () => {
  it('links the invoice viewer and names the seller', () => {
    const template = invoiceUploadedTemplate({
      ...base,
      invoiceUrl: 'https://www.hanuja.com.tr/api/orders/order-1/documents/invoices/seller-1',
      sellerName: 'Atelier Noa',
      items: [line],
    })
    expect(template.subject).toBe('Faturanız Oluşturuldu — #26050042')
    expect(template.html).toContain('Faturayı Görüntüle')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/api/orders/order-1/documents/invoices/seller-1"')
    expect(template.html).toContain('Atelier Noa')
    expect(template.text).toContain('Fatura: https://www.hanuja.com.tr/api/orders/order-1/documents/invoices/seller-1')
  })
})

describe('customerOrderCancelledTemplate', () => {
  it('states the actor, cancelled quantities, reason and refund for a partial customer cancellation', () => {
    const template = customerOrderCancelledTemplate({
      ...base,
      items: [{ ...line, quantity: 1, lineTotal: '4.850 TL' }],
      partial: true,
      actorRole: 'customer',
      reason: 'Fikrim değişti',
      refundAmount: '4.850 TL',
      paymentMethod: 'card',
    })
    expect(template.subject).toBe('Siparişinizin Bir Kısmı İptal Edildi — #26050042')
    expect(template.html).toContain('talebiniz üzerine iptal edildi')
    expect(template.html).toContain('İptal Adedi')
    expect(template.html).toContain('Fikrim değişti')
    expect(template.html).toContain('4.850 TL')
    expect(template.html).toContain('ödeme yaptığınız karta')
  })

  it('explains seller rejection, 20-day auto cancel and payment failure without a refund line', () => {
    const seller = customerOrderCancelledTemplate({ ...base, items: [line], partial: false, actorRole: 'seller' })
    expect(seller.subject).toBe('Siparişiniz İptal Edilmiştir — #26050042')
    expect(seller.html).toContain('satıcı tarafından iptal edildi')

    const system = customerOrderCancelledTemplate({ ...base, items: [line], partial: false, actorRole: 'system' })
    expect(system.html).toContain('sevk süresini aştığı için')

    const failure = customerOrderCancelledTemplate({ ...base, items: [line], partial: false, actorRole: 'payment_failure' })
    expect(failure.html).toContain('ödeme alınamadığı için')
    expect(failure.html).toContain('tahsilat yapılmadı')
    expect(failure.html).not.toContain('iade edilecek')
  })
})

describe('sellerOrderCancellationTemplate', () => {
  it('names the cancelling party and never leaks other sellers lines', () => {
    const template = sellerOrderCancellationTemplate({
      sellerName: 'Atelier Noa',
      sellerId: 'seller-a',
      orderNumber: '26050042',
      panelUrl: 'https://satici.hanuja.com.tr/siparisler/order-1',
      actorRole: 'admin',
      partial: true,
      cancellationReason: 'Stok hatası',
      items: [
        { ...line, sellerId: 'seller-a' },
        { ...lineWithoutImage, productName: 'Başka Mağaza', sellerId: 'seller-b' },
      ],
    })
    expect(template.subject).toBe('Sipariş İptali — #26050042')
    expect(template.html).toContain('Hanuja tarafından')
    expect(template.html).toContain('Gea Berjer')
    expect(template.html).not.toContain('Başka Mağaza')
    expect(template.html).toContain('Stok hatası')
  })
})

describe('return templates', () => {
  it('renders the return request with quantities and reason', () => {
    const template = returnRequestTemplate({ ...base, items: [line], returnReason: 'Ürün hasarlı geldi' })
    expect(template.subject).toBe('İade Talebiniz Alındı — #26050042')
    expect(template.html).toContain('İade Adedi')
    expect(template.html).toContain('Ürün hasarlı geldi')
  })

  it('renders cargo instructions when the seller accepts the request', () => {
    const template = returnCargoInfoReadyTemplate({
      ...base,
      items: [line],
      cargoAddress: 'Atölye Sk. No:3 Kadıköy / İstanbul',
      cargoCarrier: 'Yurtiçi Kargo',
      cargoInstructions: 'Anlaşmalı kod: 123',
    })
    expect(template.subject).toBe('İade Talebiniz Kabul Edildi — Ürünü Kargoya Verin — #26050042')
    expect(template.html).toContain('Atölye Sk. No:3 Kadıköy / İstanbul')
    expect(template.html).toContain('Anlaşmalı kod: 123')
    expect(template.html).toContain('Kargo Bilgisi Gir')
    expect(template.text).toContain('İade adresi: Atölye Sk. No:3 Kadıköy / İstanbul')
  })

  it('renders line-level accepted/rejected quantities for a partial decision and a dispute note on rejection', () => {
    const partial = returnDecisionTemplate({
      ...base,
      decision: 'partial',
      refundAmount: '4.850 TL',
      refundOutcome: 'processing',
      disputeOpened: true,
      items: [
        { ...line, acceptedQuantity: 1, rejectedQuantity: 1, rejectionReason: 'Ürün kullanılmış' },
        { ...lineWithoutImage, acceptedQuantity: 1, rejectedQuantity: 0 },
      ],
    })
    expect(partial.subject).toBe('İade Talebiniz Kısmen Kabul Edildi — #26050042')
    expect(partial.html).toContain('Kabul')
    expect(partial.html).toContain('Red gerekçesi: Ürün kullanılmış')
    expect(partial.html).toContain('4.850 TL')
    expect(partial.html).toContain('uyuşmazlık incelemesine')
    expect(partial.text).toContain('Gea Berjer / Doğal keten — Kabul: 1, Red: 1 (Red gerekçesi: Ürün kullanılmış)')

    const rejected = returnDecisionTemplate({
      ...base,
      decision: 'rejected',
      disputeOpened: true,
      items: [{ ...line, acceptedQuantity: 0, rejectedQuantity: 2, rejectionReason: 'Yanlış ürün gönderildi' }],
    })
    expect(rejected.subject).toBe('İade Talebiniz Reddedildi — #26050042')
    expect(rejected.html).toContain('Hanuja uyuşmazlık incelemesine taşındı')

    const approved = returnDecisionTemplate({
      ...base,
      decision: 'approved',
      refundAmount: '9.700 TL',
      refundOutcome: 'processing',
      items: [{ ...line, acceptedQuantity: 2, rejectedQuantity: 0 }],
    })
    expect(approved.subject).toBe('İade Talebiniz Kabul Edildi — #26050042')
    expect(approved.html).toContain('9.700 TL')
    expect(approved.html).toContain('bankanıza aktarıldığında size ayrıca e-posta')
  })

  it('derives the money wording from the persisted refund state and never claims a queued job', () => {
    const items = [{ ...line, acceptedQuantity: 2, rejectedQuantity: 0 }]
    const render = (refundOutcome: Parameters<typeof returnDecisionTemplate>[0]['refundOutcome']) =>
      returnDecisionTemplate({ ...base, decision: 'approved', refundAmount: '9.700 TL', refundOutcome, items })

    // No refund record yet: the item has not come back, so no refund claim.
    const awaiting = render('awaiting_return')
    expect(awaiting.subject).toBe('İade Talebiniz Kabul Edildi — Ürünü Kargoya Verin — #26050042')
    expect(awaiting.html).toContain('Ürünü iade kargo bilgileriyle gönderin')
    expect(awaiting.html).not.toContain('9.700 TL')
    expect(awaiting.html).not.toContain('oluşturuldu')

    expect(render('processing').html).toContain('bankanıza aktarıldığında')
    expect(render('manual_review').html).toContain('manuel kontrolü sonrasında')
    expect(render('manual_review').html).not.toContain('oluşturuldu')
    expect(render('no_refund_due').html).toContain('Bu talep kapsamında geri ödenecek tutar bulunmuyor')
    expect(render('completed').html).toContain('tamamlandı')
    expect(render('under_review').html).toContain('ekibimizce izleniyor')

    // Legacy payloads without an outcome must not claim a started payment.
    const legacy = returnDecisionTemplate({ ...base, decision: 'approved', items })
    expect(legacy.html).toContain('ekibimizce izleniyor')
    for (const outcome of ['awaiting_return', 'processing', 'manual_review', 'no_refund_due', 'completed', 'under_review'] as const) {
      expect(render(outcome).html).not.toContain('kuyruğa alındı')
      expect(render(outcome).text).not.toContain('kuyruğa alındı')
    }
  })
})

describe('refundCompletedTemplate', () => {
  it('names the payment channel the money went back to', () => {
    const card = refundCompletedTemplate({ ...base, items: [line], refundAmount: '9.700 TL', paymentMethod: 'card' })
    expect(card.subject).toBe('Geri Ödemeniz Yapılmıştır — #26050042')
    expect(card.html).toContain('ödeme yaptığınız karta')
    const eft = refundCompletedTemplate({ ...base, items: [line], refundAmount: '9.700 TL', paymentMethod: 'eft' })
    expect(eft.html).toContain('IBAN hesabına')
    expect(eft.text).toContain('9.700 TL')
  })
})
