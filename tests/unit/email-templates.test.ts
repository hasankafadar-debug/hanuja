import { describe, expect, it } from 'vitest'
import { orderConfirmationTemplate } from '../../api/lib/email-templates'

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
