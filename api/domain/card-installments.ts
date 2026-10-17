/**
 * Kart ödemesi taksit ve sepet kuralları (saf fonksiyonlar).
 *
 * Para kuralı (docs/05-security/payment-security.md §7):
 *   price      = Order.totalAmount (peşin toplam: ürün + kargo − kuponlar)
 *   paidPrice  = Iyzico taksit sorgusunun totalPrice değeri
 *   vade farkı = paidPrice − price (müşteri öder; tasarımcı hakedişine girmez)
 */
import { Decimal } from '@prisma/client/runtime/client'

export interface InstallmentOffer {
  installmentNumber: number
  installmentPrice: string
  totalPrice: string
}

/**
 * Ürünün etkin taksit üst sınırı: kendi kategorisi, yoksa en yakın üst kategori.
 * Zincirin tamamı boşsa null (sınır yok). resolveCategoryTaxRate ile aynı miras kuralı.
 */
export function resolveCategoryInstallmentLimit(
  categoryId: string | null | undefined,
  categories: Map<string, { parentId: string | null; maxInstallmentCount: number | null }>,
): number | null {
  let currentId = categoryId ?? null
  const seen = new Set<string>()
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId)
    const category = categories.get(currentId)
    if (!category) break
    if (category.maxInstallmentCount !== null && category.maxInstallmentCount !== undefined) {
      return Math.max(1, category.maxInstallmentCount)
    }
    currentId = category.parentId
  }
  return null
}

/** Sepet sınırı: ürünlerin etkin sınırlarının en küçüğü; hiçbirinde sınır yoksa null. */
export function basketInstallmentLimit(limits: Array<number | null>): number | null {
  const concrete = limits.filter((limit): limit is number => limit !== null)
  return concrete.length > 0 ? Math.min(...concrete) : null
}

export type InstallmentSelection =
  | { ok: true; offers: InstallmentOffer[] }
  | { ok: false; reason: 'single_payment_price_mismatch' | 'no_offer' }

/**
 * Müşteriye gösterilecek seçenekler:
 * - Iyzico'nun döndürdüğü seçenekler ∩ sepet sınırı; banka/ön ödemeli kartta yalnız tek çekim.
 * - Tek çekimde totalPrice price'a eşit olmalı (sözleşme tek çekimde fark kabul etmez).
 * - BIN bulunamadıysa (offers=null) yalnız tek çekim (paidPrice = price); kabulü Iyzico verir.
 */
export function selectInstallmentOffers(params: {
  price: Decimal
  offers: InstallmentOffer[] | null
  cardType: string | null
  limit: number | null
}): InstallmentSelection {
  const single: InstallmentOffer = {
    installmentNumber: 1,
    installmentPrice: params.price.toFixed(2),
    totalPrice: params.price.toFixed(2),
  }
  if (params.offers === null) return { ok: true, offers: [single] }

  const providerSingle = params.offers.find((offer) => offer.installmentNumber === 1)
  if (providerSingle && !new Decimal(providerSingle.totalPrice).eq(params.price)) {
    return { ok: false, reason: 'single_payment_price_mismatch' }
  }

  const creditCard = params.cardType === 'CREDIT_CARD'
  const allowed = params.offers.filter((offer) => {
    if (offer.installmentNumber < 1) return false
    if (offer.installmentNumber === 1) return true
    if (!creditCard) return false
    if (params.limit !== null && offer.installmentNumber > params.limit) return false
    const total = new Decimal(offer.totalPrice)
    // Vade farkı negatif olamaz; Iyzico'dan beklenmeyen veri gelirse seçenek gösterilmez.
    return total.gte(params.price)
  })

  const offers = allowed.some((offer) => offer.installmentNumber === 1)
    ? allowed
    : [single, ...allowed]
  return offers.length > 0 ? { ok: true, offers } : { ok: false, reason: 'no_offer' }
}

export interface BasketSourceLine {
  orderLineId: string
  amount: Decimal
}

export interface BasketItemSpec {
  providerItemId: string
  kind: 'product' | 'shipping'
  orderLineId: string | null
  amount: Decimal
}

/**
 * Iyzico sepeti: tutarı 0 olan kalem gönderilemez, kalemler toplamı price'a eşit olmalı.
 * Eşit değilse null döner (3DS başlatılmaz).
 */
export function buildCardBasket(params: {
  orderId: string
  lines: BasketSourceLine[]
  shippingAmount: Decimal
  price: Decimal
}): BasketItemSpec[] | null {
  const items: BasketItemSpec[] = [
    ...params.lines
      .filter((line) => line.amount.gt(0))
      .map((line) => ({
        providerItemId: `line:${line.orderLineId}`,
        kind: 'product' as const,
        orderLineId: line.orderLineId,
        amount: line.amount,
      })),
    ...(params.shippingAmount.gt(0)
      ? [
          {
            providerItemId: `shipping:${params.orderId}`,
            kind: 'shipping' as const,
            orderLineId: null,
            amount: params.shippingAmount,
          },
        ]
      : []),
  ]
  const total = items.reduce((sum, item) => sum.add(item.amount), new Decimal(0))
  return items.length > 0 && total.eq(params.price) ? items : null
}

export interface ProviderItemAmount {
  providerItemId: string
  amount: Decimal
}

export interface CapturedItem {
  itemId: string
  paymentTransactionId: string
  price: string
  paidPrice: string
}

export type CaptureAllocation =
  | {
      ok: true
      items: Array<{
        providerItemId: string
        paymentTransactionId: string
        basePrice: Decimal
        paidPrice: Decimal
        installmentShare: Decimal
      }>
    }
  | { ok: false; reason: string }

/**
 * Iyzico'nun kalem bazlı paidPrice değerlerini doğrular ve vade farkı paylarını çıkarır.
 * Kalem kümesi, kalem price'ları ve toplamlar kuruşu kuruşuna tutmalıdır.
 */
export function allocateCapturedItems(params: {
  expected: ProviderItemAmount[]
  captured: CapturedItem[]
  price: Decimal
  paidPrice: Decimal
}): CaptureAllocation {
  const byId = new Map(params.captured.map((item) => [item.itemId, item]))
  if (byId.size !== params.captured.length || byId.size !== params.expected.length) {
    return { ok: false, reason: 'item_set_mismatch' }
  }
  const items: Extract<CaptureAllocation, { ok: true }>['items'] = []
  let priceSum = new Decimal(0)
  let paidSum = new Decimal(0)
  for (const expected of params.expected) {
    const captured = byId.get(expected.providerItemId)
    if (!captured) return { ok: false, reason: 'item_set_mismatch' }
    const basePrice = new Decimal(captured.price)
    const paidPrice = new Decimal(captured.paidPrice)
    if (!basePrice.eq(expected.amount)) return { ok: false, reason: 'item_price_mismatch' }
    if (paidPrice.lt(basePrice)) return { ok: false, reason: 'item_paid_below_price' }
    priceSum = priceSum.add(basePrice)
    paidSum = paidSum.add(paidPrice)
    items.push({
      providerItemId: expected.providerItemId,
      paymentTransactionId: captured.paymentTransactionId,
      basePrice,
      paidPrice,
      installmentShare: paidPrice.sub(basePrice),
    })
  }
  if (!priceSum.eq(params.price)) return { ok: false, reason: 'price_sum_mismatch' }
  if (!paidSum.eq(params.paidPrice)) return { ok: false, reason: 'paid_sum_mismatch' }
  return { ok: true, items }
}
