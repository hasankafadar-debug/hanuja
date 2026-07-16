import { describe, expect, it } from 'vitest'
import { sellerApprovalTemplate } from '../../api/lib/email-templates/seller-approval'
import { sellerDocumentsRequestedTemplate } from '../../api/lib/email-templates/seller-documents-requested'
import { sellerPasswordResetTemplate } from '../../api/lib/email-templates/seller-password-reset'
import { orderConfirmationTemplate } from '../../api/lib/email-templates'
import { PLATFORM_LEGAL_INFO } from '../../api/lib/platform-info'

describe('Hanuja contact email policy', () => {
  it('keeps support, transactional sender, and legal KEP addresses separate', () => {
    expect(PLATFORM_LEGAL_INFO.supportEmail).toBe('admin@hanuja.com.tr')
    expect(PLATFORM_LEGAL_INFO.transactionalEmail).toBe('noreply@hanuja.com.tr')
    expect(PLATFORM_LEGAL_INFO.kvkkEmail).toBe('suatsalihayakkabideri@hs01.kep.tr')
  })

  it('shows the admin address in customer and seller email templates', () => {
    const templates = [
      orderConfirmationTemplate({
        customerName: 'Test Musteri',
        orderNumber: 'TEST-1',
        totalAmount: '100,00 TL',
        items: [{ name: 'Test Urun', quantity: 1, price: '100,00 TL' }],
        paymentMethod: 'card',
      }),
      sellerApprovalTemplate({
        email: 'seller@example.com',
        panelUrl: 'https://satici.hanuja.com.tr',
        tempPassword: 'temporary-password',
      }),
      sellerDocumentsRequestedTemplate({
        email: 'seller@example.com',
        panelUrl: 'https://satici.hanuja.com.tr',
        requiredDocTypes: ['Vergi levhasi'],
      }),
      sellerPasswordResetTemplate({
        email: 'seller@example.com',
        resetUrl: 'https://satici.hanuja.com.tr/sifre-sifirla',
      }),
    ]
    const deprecatedSupportAddress = ['destek', 'hanuja.com.tr'].join('@')

    for (const template of templates) {
      expect(template.html).toContain('admin@hanuja.com.tr')
      expect(template.html).not.toContain(deprecatedSupportAddress)
    }
  })
})
