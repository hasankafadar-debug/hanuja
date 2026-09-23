import { describe, expect, it } from 'vitest'
import {
  customerProductQuestionAnsweredTemplate,
  sellerProductQuestionTemplate,
} from '../../api/lib/email-templates'

describe('product question e-mail templates', () => {
  it('builds the seller "Müşteri Sorusu" e-mail with a link to the panel conversation', () => {
    const email = sellerProductQuestionTemplate({
      sellerName: 'Atelier Noa',
      productName: 'Gea Berjer',
      productImageUrl: 'https://media.hanuja.tr/p/gea.jpg',
      customerName: 'Ayşe Y.',
      orderNumber: '26050001',
      messageExcerpt: 'Ölçüleri nedir?\nRengi nasıl?',
      panelUrl: 'https://satici.hanuja.com.tr/musteri-sorulari/t1',
    })
    expect(email.subject).toBe('Müşteri Sorusu — Gea Berjer')
    expect(email.html).toContain('https://satici.hanuja.com.tr/musteri-sorulari/t1')
    expect(email.html).toContain('https://media.hanuja.tr/p/gea.jpg')
    expect(email.html).toContain('Ölçüleri nedir?<br />Rengi nasıl?')
    expect(email.html).toContain('Ayşe Y.')
    expect(email.html).toContain('#26050001')
    expect(email.text).toContain('Soruyu yanıtla: https://satici.hanuja.com.tr/musteri-sorulari/t1')
    expect(email.text).toContain('Ölçüleri nedir?\nRengi nasıl?')
  })

  it('builds the customer "Sorunuz yanıtlandı" e-mail with a link to the account conversation', () => {
    const email = customerProductQuestionAnsweredTemplate({
      customerName: 'Ayşe',
      sellerName: 'Atelier Noa',
      productName: 'Gea Berjer',
      messageExcerpt: 'Oturum yüksekliği 45 cm.',
      threadUrl: 'https://www.hanuja.com.tr/hesabim/sorularim/t1',
    })
    expect(email.subject).toBe('Sorunuz yanıtlandı — Gea Berjer')
    expect(email.html).toContain('https://www.hanuja.com.tr/hesabim/sorularim/t1')
    expect(email.html).toContain('Merhaba Ayşe')
    expect(email.text).toContain('Konuşmayı görüntüle: https://www.hanuja.com.tr/hesabim/sorularim/t1')
    expect(email.text).not.toContain('Sipariş:')
  })

  it('escapes seller- and customer-controlled text in the HTML body', () => {
    const email = sellerProductQuestionTemplate({
      sellerName: '<b>Mağaza</b>',
      productName: 'Berjer <script>alert(1)</script>',
      messageExcerpt: '<img src=x onerror=alert(1)>',
      panelUrl: 'https://satici.hanuja.com.tr/musteri-sorulari/t1',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img src=x')
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(email.html).toContain('&lt;b&gt;Mağaza&lt;/b&gt;')
  })

  it('drops unsafe image and link URLs', () => {
    const email = customerProductQuestionAnsweredTemplate({
      sellerName: 'Atelier Noa',
      productName: 'Gea',
      productImageUrl: 'javascript:alert(1)',
      messageExcerpt: 'Yanıt',
      threadUrl: 'javascript:alert(1)',
    })
    expect(email.html).not.toContain('javascript:')
    expect(email.html).toContain('Merhaba Değerli Müşterimiz')
  })
})
