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

/** Hanuja işyerine açık seçenekler (21.10.2026) ∩ kategori sınırı; 1 tek çekimdir. */
export function checkoutFormInstallments(limit: number | null): number[] {
  return [1, 2, 3, 6, 9].filter((count) => count === 1 || limit === null || count <= limit)
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

/** Kuruşun altında tutulan hane sayısı; iyzico kalem paidPrice değerlerini 8 haneyle döndürür. */
const SUB_KURUS_DIGITS = 10
const SUB_KURUS_PER_KURUS = 10 ** SUB_KURUS_DIGITS

/** Tutarı tam kuruşa ve kuruşun altındaki küsura ayırır (ör. "673.56752371" → 67356 kuruş + küsur). */
function splitKurus(value: string): { kurus: number; remainder: number } | null {
  const match = /^(\d+)(?:\.(\d{0,12}))?$/.exec(value.trim())
  if (!match) return null
  const fraction = (match[2] ?? '').padEnd(2 + SUB_KURUS_DIGITS, '0')
  return {
    kurus: Number(match[1]) * 100 + Number(fraction.slice(0, 2)),
    remainder: Number(fraction.slice(2)),
  }
}

function formatKurus(kurus: number): string {
  return `${Math.floor(kurus / 100)}.${String(kurus % 100).padStart(2, '0')}`
}

/**
 * iyzico taksitli ödemede kalem paidPrice değerlerini oransal ve kuruştan hassas döndürür
 * (ör. 673.56752371 + 104.19247632 = 777.76). Değerler kuruşa indirilir; eksik kalan kuruşlar en
 * büyük küsurlu kalemden başlayarak dağıtılır, böylece yuvarlanmış toplam paidPrice'a tam eşit olur.
 * Ham toplam paidPrice'tan bir kuruş veya daha fazla saparsa null döner.
 * iyzico bu yuvarlanmış tutarları kalem iadesinde tavan olarak kabul eder (sandbox, 2026-10-17).
 */
export function roundCapturedPaidPrices(
  rawPaidPrices: string[],
  paidPrice: Decimal,
): Decimal[] | null {
  const target = splitKurus(paidPrice.toFixed(2))
  const parts = rawPaidPrices.map(splitKurus)
  if (!target || parts.some((part) => part === null)) return null
  const items = parts as Array<{ kurus: number; remainder: number }>
  const missingKurus = target.kurus - items.reduce((sum, item) => sum + item.kurus, 0)
  const remainderSum = items.reduce((sum, item) => sum + item.remainder, 0)
  if (Math.abs(remainderSum - missingKurus * SUB_KURUS_PER_KURUS) >= SUB_KURUS_PER_KURUS) {
    return null
  }
  if (missingKurus < 0 || missingKurus > items.length) return null
  const kurus = items.map((item) => item.kurus)
  const byRemainder = items
    .map((item, index) => ({ index, remainder: item.remainder }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of byRemainder.slice(0, missingKurus)) kurus[index] = kurus[index]! + 1
  return kurus.map((value) => new Decimal(formatKurus(value)))
}

/**
 * Iyzico'nun kalem bazlı paidPrice değerlerini doğrular ve vade farkı paylarını çıkarır.
 * Kalem kümesi ve kalem price'ları birebir tutmalıdır; paidPrice değerleri kuruşa yuvarlanır
 * (roundCapturedPaidPrices) ve toplamları paidPrice'a kuruşu kuruşuna eşittir.
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
  const matched: Array<{ providerItemId: string; captured: CapturedItem; basePrice: Decimal }> = []
  let priceSum = new Decimal(0)
  for (const expected of params.expected) {
    const captured = byId.get(expected.providerItemId)
    if (!captured) return { ok: false, reason: 'item_set_mismatch' }
    const basePrice = new Decimal(captured.price)
    if (!basePrice.eq(expected.amount)) return { ok: false, reason: 'item_price_mismatch' }
    if (new Decimal(captured.paidPrice).lt(basePrice)) {
      return { ok: false, reason: 'item_paid_below_price' }
    }
    priceSum = priceSum.add(basePrice)
    matched.push({ providerItemId: expected.providerItemId, captured, basePrice })
  }
  if (!priceSum.eq(params.price)) return { ok: false, reason: 'price_sum_mismatch' }
  const paidPrices = roundCapturedPaidPrices(
    matched.map((item) => String(item.captured.paidPrice)),
    params.paidPrice,
  )
  if (!paidPrices) return { ok: false, reason: 'paid_sum_mismatch' }
  return {
    ok: true,
    items: matched.map((item, index) => ({
      providerItemId: item.providerItemId,
      paymentTransactionId: item.captured.paymentTransactionId,
      basePrice: item.basePrice,
      paidPrice: paidPrices[index]!,
      installmentShare: paidPrices[index]!.sub(item.basePrice),
    })),
  }
}
