import { describe, expect, it } from 'vitest'
import { Decimal } from '@prisma/client/runtime/client'
import {
  allocateCapturedItems,
  basketInstallmentLimit,
  buildCardBasket,
  resolveCategoryInstallmentLimit,
  selectInstallmentOffers,
} from '../../../api/domain/card-installments'

const categories = new Map([
  ['root', { parentId: null, maxInstallmentCount: 9 }],
  ['mid', { parentId: 'root', maxInstallmentCount: null }],
  ['leaf', { parentId: 'mid', maxInstallmentCount: null }],
  ['limited', { parentId: 'mid', maxInstallmentCount: 3 }],
  ['free', { parentId: null, maxInstallmentCount: null }],
])

const offers = [
  { installmentNumber: 1, installmentPrice: '1000.00', totalPrice: '1000.00' },
  { installmentNumber: 3, installmentPrice: '346.67', totalPrice: '1040.00' },
  { installmentNumber: 6, installmentPrice: '180.00', totalPrice: '1080.00' },
  { installmentNumber: 12, installmentPrice: '95.00', totalPrice: '1140.00' },
]

describe('kategori taksit sınırı', () => {
  it('kendi değeri yoksa en yakın üst kategoriden devralır', () => {
    expect(resolveCategoryInstallmentLimit('leaf', categories)).toBe(9)
    expect(resolveCategoryInstallmentLimit('limited', categories)).toBe(3)
  })

  it('zincirin tamamı boşsa sınır yoktur', () => {
    expect(resolveCategoryInstallmentLimit('free', categories)).toBeNull()
    expect(resolveCategoryInstallmentLimit(null, categories)).toBeNull()
  })

  it('sepette en düşük sınır uygulanır, sınırsız ürünler etkilemez', () => {
    expect(basketInstallmentLimit([9, null, 3])).toBe(3)
    expect(basketInstallmentLimit([null, null])).toBeNull()
  })
})

describe('taksit seçenekleri', () => {
  const price = new Decimal('1000.00')

  it('kredi kartında iyzico seçenekleri sepet sınırıyla kesişir', () => {
    const result = selectInstallmentOffers({ price, offers, cardType: 'CREDIT_CARD', limit: 6 })
    expect(result.ok && result.offers.map((offer) => offer.installmentNumber)).toEqual([1, 3, 6])
  })

  it('banka kartında yalnız tek çekim sunulur', () => {
    const result = selectInstallmentOffers({ price, offers, cardType: 'DEBIT_CARD', limit: null })
    expect(result.ok && result.offers.map((offer) => offer.installmentNumber)).toEqual([1])
  })

  it('BIN bulunamadıysa yalnız peşin tutarla tek çekim', () => {
    const result = selectInstallmentOffers({ price, offers: null, cardType: null, limit: null })
    expect(result).toEqual({
      ok: true,
      offers: [{ installmentNumber: 1, installmentPrice: '1000.00', totalPrice: '1000.00' }],
    })
  })

  it('tek çekimde iyzico farklı toplam döndürürse teklif üretilmez', () => {
    const result = selectInstallmentOffers({
      price,
      offers: [{ installmentNumber: 1, installmentPrice: '1010.00', totalPrice: '1010.00' }],
      cardType: 'CREDIT_CARD',
      limit: null,
    })
    expect(result).toEqual({ ok: false, reason: 'single_payment_price_mismatch' })
  })

  it('peşinden düşük taksit toplamı gösterilmez', () => {
    const result = selectInstallmentOffers({
      price,
      offers: [...offers, { installmentNumber: 2, installmentPrice: '400.00', totalPrice: '800.00' }],
      cardType: 'CREDIT_CARD',
      limit: null,
    })
    expect(result.ok && result.offers.some((offer) => offer.installmentNumber === 2)).toBe(false)
  })
})

describe('iyzico sepeti', () => {
  it('tutarı 0 olan satırı sepete koymaz ve toplamı doğrular', () => {
    const basket = buildCardBasket({
      orderId: 'o1',
      lines: [
        { orderLineId: 'a', amount: new Decimal('950.01') },
        { orderLineId: 'b', amount: new Decimal('0') },
      ],
      shippingAmount: new Decimal('49.99'),
      price: new Decimal('1000.00'),
    })
    expect(basket?.map((item) => item.providerItemId)).toEqual(['line:a', 'shipping:o1'])
  })

  it('toplam fiyatla tutmazsa sepet üretilmez', () => {
    expect(
      buildCardBasket({
        orderId: 'o1',
        lines: [{ orderLineId: 'a', amount: new Decimal('900') }],
        shippingAmount: new Decimal('0'),
        price: new Decimal('1000'),
      }),
    ).toBeNull()
  })
})

describe('tahsil edilen kalemlerin doğrulanması', () => {
  const expected = [
    { providerItemId: 'line:a', amount: new Decimal('600.00') },
    { providerItemId: 'line:b', amount: new Decimal('350.01') },
    { providerItemId: 'shipping:o1', amount: new Decimal('49.99') },
  ]
  const captured = [
    { itemId: 'line:a', paymentTransactionId: 't1', price: '600.00', paidPrice: '648.00' },
    { itemId: 'line:b', paymentTransactionId: 't2', price: '350.01', paidPrice: '378.01' },
    { itemId: 'shipping:o1', paymentTransactionId: 't3', price: '49.99', paidPrice: '53.99' },
  ]

  it('vade farkı payları kalemlerden çıkarılır ve kuruşu kuruşuna toplamı tutar', () => {
    const result = allocateCapturedItems({
      expected,
      captured,
      price: new Decimal('1000.00'),
      paidPrice: new Decimal('1080.00'),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((item) => item.installmentShare.toFixed(2))).toEqual([
      '48.00',
      '28.00',
      '4.00',
    ])
  })

  it('kalem toplamı paidPrice ile tutmazsa reddeder', () => {
    const result = allocateCapturedItems({
      expected,
      captured,
      price: new Decimal('1000.00'),
      paidPrice: new Decimal('1080.01'),
    })
    expect(result).toEqual({ ok: false, reason: 'paid_sum_mismatch' })
  })

  it('beklenmeyen kalem kümesini reddeder', () => {
    const result = allocateCapturedItems({
      expected,
      captured: captured.slice(0, 2),
      price: new Decimal('1000.00'),
      paidPrice: new Decimal('1026.01'),
    })
    expect(result).toEqual({ ok: false, reason: 'item_set_mismatch' })
  })

  it('kalem fiyatı sepetteki tutarla tutmazsa reddeder', () => {
    const result = allocateCapturedItems({
      expected,
      captured: [{ ...captured[0]!, price: '599.00' }, captured[1]!, captured[2]!],
      price: new Decimal('1000.00'),
      paidPrice: new Decimal('1080.00'),
    })
    expect(result).toEqual({ ok: false, reason: 'item_price_mismatch' })
  })
})
