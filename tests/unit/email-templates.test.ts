import { describe, expect, it } from 'vitest'
import {
  invoiceUploadedTemplate,
  orderConfirmationTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  productDiscountTemplate,
  storeDiscountFollowedSellerTemplate,
} from '../../api/lib/email-templates'

describe('orderConfirmationTemplate', () => {
  it('includes EFT payment details and bank reference when provided', () => {
    const template = orderConfirmationTemplate({
      customerName: 'Ayşe',
      orderNumber: 'ABC12345',
      totalAmount: '₺1.250,00',
      items: [{ name: 'Sandalye', quantity: 1, price: '₺1.250,00' }],
      paymentMethod: 'eft',
      bankTransferInstructions: {
        bankName: 'Örnek Bank',
        accountHolder: 'Hanuja',
        iban: 'TR00 0000 0000 0000 0000 0000 00',
        reference: 'ABC12345',
      },
    })

    expect(template.html).toContain('Ödeme Yöntemi:</strong> Havale / EFT')
    expect(template.html).toContain('Örnek Bank')
    expect(template.html).toContain('ABC12345')
  })

  it('renders fallback guidance when bank info is missing', () => {
    const template = orderConfirmationTemplate({
      customerName: 'Ayşe',
      orderNumber: 'ABC12345',
      totalAmount: '₺1.250,00',
      items: [{ name: 'Sandalye', quantity: 1, price: '₺1.250,00' }],
      paymentMethod: 'eft',
      bankTransferInstructions: {
        bankName: '',
        accountHolder: '',
        iban: '',
        reference: 'ABC12345',
        missing: true,
      },
    })

    expect(template.html).toContain('Banka bilgileri için lütfen destek ekibimizle iletişime geçin.')
  })
})

describe('invoiceUploadedTemplate', () => {
  it('renders a CTA button and the order URL in text when orderUrl is provided', () => {
    const template = invoiceUploadedTemplate({
      customerName: 'Ayşe',
      orderNumber: 'ABC12345',
      orderUrl: 'https://www.hanuja.com.tr/siparis/order-1',
    })

    expect(template.subject).toBe('Faturanız Hazır — #ABC12345')
    expect(template.html).toContain('Siparişimi Görüntüle')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/siparis/order-1"')
    expect(template.text).toContain('https://www.hanuja.com.tr/siparis/order-1')
  })

  it('renders legacy layout without the CTA or order URL when orderUrl is absent', () => {
    const template = invoiceUploadedTemplate({
      customerName: 'Ayşe',
      orderNumber: 'ABC12345',
    })

    expect(template.html).not.toContain('Siparişimi Görüntüle')
    expect(template.html).not.toContain('/siparis/')
    expect(template.text).not.toContain('/siparis/')
    expect(template.text).not.toContain('Sipariş detayı:')
  })

  it('omits the CTA when orderUrl is an empty string (backward-compatible job payloads)', () => {
    const template = invoiceUploadedTemplate({
      customerName: 'Ayşe',
      orderNumber: 'ABC12345',
      orderUrl: '',
    })

    expect(template.html).not.toContain('Siparişimi Görüntüle')
    expect(template.html).not.toContain('/siparis/')
    expect(template.text).not.toContain('Sipariş detayı:')
  })
})

describe('passwordResetTemplate', () => {
  it('includes the reset link and 1-hour validity notice', () => {
    const template = passwordResetTemplate({ resetUrl: 'https://www.hanuja.com.tr/sifre-sifirla?token=abc123' })

    expect(template.subject).toBe('Şifre Sıfırlama Talebi')
    expect(template.html).toContain('https://www.hanuja.com.tr/sifre-sifirla?token=abc123')
    expect(template.html).toContain('1 saat geçerlidir')
    expect(template.html).toContain('Bu talebi siz yapmadıysanız bu e-postayı yok sayabilirsiniz.')
    expect(template.text).toContain('https://www.hanuja.com.tr/sifre-sifirla?token=abc123')
  })
})

describe('productDiscountTemplate', () => {
  it('renders the favorite-context subject, CTA, and unsubscribe link', () => {
    const template = productDiscountTemplate({
      customerName: 'Ayşe',
      productName: 'Meşe Sehpa',
      productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
      sellerName: 'Atelier Noa',
      context: 'favorite',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.subject).toBe('Favorinizdeki Ürün Şimdi İndirimde')
    expect(template.html).toContain('Favorilerinize eklediğiniz')
    expect(template.html).toContain('Meşe Sehpa')
    expect(template.html).toContain('Atelier Noa')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/urun/mese-sehpa"')
    expect(template.html).toContain('Ürünü İncele')
    expect(template.html).toContain('href="https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc"')
    expect(template.html).toContain('abonelikten çıkın')
    expect(template.text).toContain('https://www.hanuja.com.tr/urun/mese-sehpa')
    expect(template.text).toContain('https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc')
  })

  it('renders the cart-context subject and copy', () => {
    const template = productDiscountTemplate({
      customerName: 'Mehmet',
      productName: 'Rattan Konsol',
      productUrl: 'https://www.hanuja.com.tr/urun/rattan-konsol',
      sellerName: 'Woodform',
      context: 'cart',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=xyz',
    })

    expect(template.subject).toBe('Sepetinizdeki Ürün Şimdi İndirimde')
    expect(template.html).toContain('Sepetinizdeki')
    expect(template.html).toContain('Rattan Konsol')
    expect(template.html).toContain('Woodform')
    expect(template.text).toContain('Sepetinizdeki Rattan Konsol ürünü, Woodform mağazasında şimdi indirimde.')
  })

  it('escapes a malicious productName in html but leaves the text branch raw', () => {
    const malicious = '<script>alert(1)</script>'
    const template = productDiscountTemplate({
      customerName: 'Ayşe',
      productName: malicious,
      productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
      sellerName: 'Atelier Noa',
      context: 'favorite',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.html).not.toContain(malicious)
    expect(template.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    // Text branch is plain-text delivery (no HTML rendering context) — stays raw.
    expect(template.text).toContain(malicious)
  })

  it('escapes a malicious sellerName and customerName in html', () => {
    const template = productDiscountTemplate({
      customerName: '"><img src=x onerror=alert(1)>',
      productName: 'Meşe Sehpa',
      productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
      sellerName: '<b>Evil Seller</b>',
      context: 'cart',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.html).not.toContain('<img src=x onerror=alert(1)>')
    expect(template.html).not.toContain('<b>Evil Seller</b>')
    expect(template.html).toContain('&lt;b&gt;Evil Seller&lt;/b&gt;')
  })

  it('omits the anchor and renders no href when productUrl is not http(s) (e.g. javascript: URL)', () => {
    const template = productDiscountTemplate({
      customerName: 'Ayşe',
      productName: 'Meşe Sehpa',
      productUrl: 'javascript:alert(1)',
      sellerName: 'Atelier Noa',
      context: 'favorite',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.html).not.toContain('javascript:alert(1)')
    expect(template.html).not.toContain('<a\n        href="javascript:alert(1)"')
    expect(template.html).not.toMatch(/href="javascript:/i)
    expect(template.html).toContain('Ürünü İncele') // CTA label still renders, just without a link
  })

  it('omits the unsubscribe anchor when unsubscribeUrl is not http(s)', () => {
    const template = productDiscountTemplate({
      customerName: 'Ayşe',
      productName: 'Meşe Sehpa',
      productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa',
      sellerName: 'Atelier Noa',
      context: 'favorite',
      unsubscribeUrl: 'javascript:alert(1)',
    })

    expect(template.html).not.toMatch(/href="javascript:/i)
  })
})

describe('storeDiscountFollowedSellerTemplate', () => {
  it('escapes a malicious sellerName in html but leaves text raw', () => {
    const malicious = '<script>alert(document.cookie)</script>'
    const template = storeDiscountFollowedSellerTemplate({
      customerName: 'Ayşe',
      sellerName: malicious,
      storeUrl: 'https://www.hanuja.com.tr/magaza/atelier-noa',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.html).not.toContain(malicious)
    expect(template.html).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;')
    expect(template.text).toContain(malicious)
  })

  it('omits the store anchor when storeUrl is not http(s)', () => {
    const template = storeDiscountFollowedSellerTemplate({
      customerName: 'Ayşe',
      sellerName: 'Atelier Noa',
      storeUrl: 'javascript:alert(1)',
      unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=abc',
    })

    expect(template.html).not.toMatch(/href="javascript:/i)
    expect(template.html).toContain('Mağazayı Gör')
  })
})

describe('passwordChangedTemplate', () => {
  it('states the password was changed and warns without any link', () => {
    const template = passwordChangedTemplate({ changedAt: new Date('2026-07-16T10:30:00Z') })

    expect(template.subject).toBe('Şifreniz Değiştirildi')
    expect(template.html).toContain('admin@hanuja.com.tr')
    expect(template.html).toContain('Bu işlemi siz yapmadıysanız')
    expect(template.html).not.toContain('<a href')
    expect(template.text).toContain('admin@hanuja.com.tr')
  })
})
