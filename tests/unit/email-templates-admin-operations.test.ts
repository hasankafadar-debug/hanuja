import { describe, expect, it } from 'vitest'
import {
  adminBankTransferPendingTemplate,
  adminCustomerSupportTicketTemplate,
  adminDisputeOpenedTemplate,
  adminFulfillmentRiskTemplate,
  adminOrderCancellationTemplate,
  adminReturnRequestedTemplate,
  adminSellerApplicationTemplate,
  adminSellerSupportTicketTemplate,
} from '../../api/lib/email-templates'

const ADMIN_URL = 'https://admin.hanuja.com.tr/siparisler/order-1'

describe('admin operation e-mail templates', () => {
  it('renders the cancellation summary with its deep link', () => {
    const mail = adminOrderCancellationTemplate({
      orderNumber: '26050042',
      adminUrl: ADMIN_URL,
      actorLabel: 'Müşteri',
      sellerName: 'Atelier Noa',
      customerName: 'Ayşe Y.',
      refundAmount: '4.850 TL',
      reason: 'Stok kalmadı',
      items: [
        { productName: 'Gea Berjer', quantity: 1, unitPrice: '4.850 TL', lineTotal: '4.850 TL' },
      ],
    })
    expect(mail.subject).toContain('Sipariş iptali')
    expect(mail.subject).toContain('26050042')
    expect(mail.html).toContain(ADMIN_URL)
    expect(mail.html).toContain('Gea Berjer')
    expect(mail.text).toContain('4.850 TL')
  })

  it('renders the return request with the flow it came from', () => {
    const mail = adminReturnRequestedTemplate({
      orderNumber: '26050042',
      adminUrl: 'https://admin.hanuja.com.tr/iadeler',
      flowLabel: 'Adet bazlı iade',
      reason: 'Ürün hasarlı',
      items: [{ productName: 'Vazo', quantity: 2, unitPrice: '100 TL', lineTotal: '200 TL' }],
    })
    expect(mail.subject).toContain('İade talebi')
    expect(mail.html).toContain('Adet bazlı iade')
    expect(mail.html).toContain('https://admin.hanuja.com.tr/iadeler')
  })

  it('states that an open dispute blocks the payout', () => {
    const mail = adminDisputeOpenedTemplate({
      orderNumber: '26050042',
      adminUrl: 'https://admin.hanuja.com.tr/uyusmazliklar/d-1',
      sourceLabel: 'Müşteri uyuşmazlık açtı',
      reason: 'Ürün eksik geldi',
    })
    expect(mail.subject).toContain('Uyuşmazlık')
    expect(mail.html).toContain('hakedişi bloklanır')
    expect(mail.html).toContain('/uyusmazliklar/d-1')
  })

  it('separates the seller and customer support mailers', () => {
    const seller = adminSellerSupportTicketTemplate({
      subject: 'Kargo etiketi basılmıyor',
      adminUrl: 'https://admin.hanuja.com.tr/destek/t-1',
      requesterName: 'Atelier Noa',
    })
    const customer = adminCustomerSupportTicketTemplate({
      subject: 'Siparişim gelmedi',
      adminUrl: 'https://admin.hanuja.com.tr/musteri-destek/t-2',
      requesterName: 'Ayşe Y.',
      categoryLabel: 'Kargo gecikmesi',
    })
    expect(seller.subject).toContain('Satıcı destek bileti')
    expect(seller.html).toContain('/destek/t-1')
    expect(customer.subject).toContain('Müşteri destek bileti')
    expect(customer.html).toContain('/musteri-destek/t-2')
    expect(customer.html).toContain('Kargo gecikmesi')
  })

  it('says the EFT order stays invisible to the seller until approval', () => {
    const mail = adminBankTransferPendingTemplate({
      orderNumber: '26050042',
      adminUrl: 'https://admin.hanuja.com.tr/odemeler',
      totalAmount: '5.000 TL',
      customerName: 'Ayşe Y.',
    })
    expect(mail.subject).toContain('Havale / EFT')
    expect(mail.html).toContain('satıcıya düşmez')
    expect(mail.html).toContain('5.000 TL')
  })

  it('carries the risk level, seller, delayed lines and overdue days', () => {
    const mail = adminFulfillmentRiskTemplate({
      orderNumber: '26050042',
      adminUrl: ADMIN_URL,
      riskLevel: 'breached',
      sellerName: 'Atelier Noa',
      deadlineLabel: '01.09.2026',
      overdueDays: 4,
      items: [{ productName: 'Masa', quantity: 1, unitPrice: '1 TL', lineTotal: '1 TL' }],
    })
    expect(mail.subject).toContain('Sevk riski')
    expect(mail.subject).toContain('Gecikme')
    expect(mail.html).toContain('Atelier Noa')
    expect(mail.html).toContain('4 gün')
    expect(mail.html).toContain('Masa')
    expect(mail.html).toContain(ADMIN_URL)
  })

  it('distinguishes a first seller application from a re-submission', () => {
    const first = adminSellerApplicationTemplate({
      sellerName: 'Atelier Noa',
      adminUrl: 'https://admin.hanuja.com.tr/saticilar/s-1',
      companyName: 'Noa Ltd.',
      city: 'İzmir',
    })
    const again = adminSellerApplicationTemplate({
      sellerName: 'Atelier Noa',
      adminUrl: 'https://admin.hanuja.com.tr/saticilar/s-1',
      submissionSeq: 2,
    })
    expect(first.subject).toContain('Yeni satıcı başvurusu')
    expect(first.html).toContain('İlk başvuru')
    expect(again.subject).toContain('yeniden gönderildi')
    expect(again.html).toContain('2. gönderim')
  })

  it('escapes operator-supplied text instead of rendering it as markup', () => {
    const mail = adminDisputeOpenedTemplate({
      orderNumber: '26050042',
      adminUrl: 'https://admin.hanuja.com.tr/uyusmazliklar/d-1',
      reason: '<script>alert(1)</script>',
      sellerName: '<b>Kötü</b>',
    })
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;')
    expect(mail.html).not.toContain('<b>Kötü</b>')
  })
})
