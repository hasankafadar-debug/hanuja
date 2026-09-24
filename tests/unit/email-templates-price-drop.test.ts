import { describe, expect, it } from 'vitest'
import { productPriceDropTemplate, PRICE_DROP_SUBJECT } from '../../api/lib/email-templates'

const base = {
  customerName: 'Ayşe <b>Yılmaz</b>',
  productName: 'Meşe <script>alert(1)</script> Sehpa',
  variantName: 'Doğal & Ceviz',
  productUrl: 'https://www.hanuja.com.tr/urun/mese-sehpa?varyant=v1',
  imageUrl: 'https://media.hanuja.tr/products/sehpa.jpg',
  priceText: '1.249,90 TL',
  unsubscribeUrl: 'https://www.hanuja.com.tr/api/marketing/unsubscribe?token=t1',
}

describe('productPriceDropTemplate', () => {
  it('uses the fixed subject and starts with "Favorilediğiniz"', () => {
    const email = productPriceDropTemplate(base)
    expect(email.subject).toBe(PRICE_DROP_SUBJECT)
    expect(email.subject).toBe('Favorilediğiniz ürün son 15 günün en düşük fiyatında')
    expect(email.text).toContain('Favorilediğiniz Meşe <script>alert(1)</script> Sehpa – Doğal & Ceviz son 15 günün en düşük fiyatında.')
  })

  it('escapes customer and product names in HTML', () => {
    const email = productPriceDropTemplate(base)
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('Meşe &lt;script&gt;alert(1)&lt;/script&gt; Sehpa – Doğal &amp; Ceviz')
    expect(email.html).toContain('Ayşe &lt;b&gt;Yılmaz&lt;/b&gt;')
  })

  it('shows only the current price: no struck-through price, no rate, no "indirim", no other variants', () => {
    const email = productPriceDropTemplate(base)
    // Visible text only: CSS in the shared layout legitimately contains "100%".
    const visibleHtml = email.html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')
    for (const body of [visibleHtml, email.text]) {
      expect(body).toContain('1.249,90 TL')
      expect(body.toLowerCase()).not.toContain('indirim')
      expect(body).not.toMatch(/%\s?\d|\d\s?%/)
      expect(body).not.toContain('seçenek daha')
    }
    expect(email.html).not.toContain('line-through')
    expect(email.html).toContain('(KDV dahil)')
    expect(email.html).toContain('Kargo ve kişisel kuponlar bu fiyata dahil değildir')
  })

  it('links to the product with the variant selected and to the unsubscribe page', () => {
    const email = productPriceDropTemplate(base)
    expect(email.html).toContain('href="https://www.hanuja.com.tr/urun/mese-sehpa?varyant=v1"')
    expect(email.html).toContain('href="https://www.hanuja.com.tr/api/marketing/unsubscribe?token=t1"')
    expect(email.html).toContain('src="https://media.hanuja.tr/products/sehpa.jpg"')
    expect(email.text).toContain('Ürünü incele: https://www.hanuja.com.tr/urun/mese-sehpa?varyant=v1')
  })

  it('omits an unsafe image and still renders without a variant', () => {
    const email = productPriceDropTemplate({ ...base, variantName: undefined, imageUrl: 'javascript:alert(1)' })
    expect(email.html).not.toContain('javascript:')
    expect(email.html).not.toContain('<img')
    expect(email.text).toContain('Favorilediğiniz Meşe <script>alert(1)</script> Sehpa son 15 günün en düşük fiyatında.')
  })
})
