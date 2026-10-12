/**
 * Satıcının Hanuja'ya keseceği alış faturası — satıcı Hanuja modeli.
 *
 * Tutar hakediş formülüyle aynıdır (07-marketplace-finance-rules.md):
 *   fatura tutarı = KDV dahil satış − satıcı kupon payı − KDV dahil komisyon
 * Satıcı faturayı ürünün KDV oranıyla (`OrderLine.taxRate`) keser; Hanuja müşteriye aynı
 * oranla fatura keser. Faturalanan adet iptal edilmemiş adettir. İptal payları
 * `allocateQuantitySlice` ile aynı birikimli sınırlarla düşülür; böylece iptal iadelerinin
 * muhasebesiyle kuruşu kuruşuna örtüşür.
 *
 * Hesap yalnız sunucu tarafında yapılır; satıcı paneli ve admin kontrolü sonucu gösterir.
 */
import { Decimal } from '@prisma/client/runtime/client'
import { roundMoney } from '@hanuja/security/money'

export interface SellerPurchaseInvoiceLineInput {
  id: string
  productName: string
  variantName?: string | null
  quantity: number
  cancelledQuantity: number
  totalPrice: Decimal
  couponDiscountAmount: Decimal
  commissionRate: Decimal
  commissionAmount: Decimal
  commissionExemptedAt?: Date | null
  taxRate: Decimal
}

export interface SellerPurchaseInvoiceLine {
  orderLineId: string
  productName: string
  variantName: string | null
  quantity: number
  taxRate: Decimal
  grossAmount: Decimal
  couponShareAmount: Decimal
  commissionRate: Decimal
  commissionAmount: Decimal
  invoiceAmount: Decimal
  netAmount: Decimal
  vatAmount: Decimal
}

export interface SellerPurchaseInvoiceVatGroup {
  taxRate: Decimal
  invoiceAmount: Decimal
  netAmount: Decimal
  vatAmount: Decimal
}

export interface SellerPurchaseInvoice {
  lines: SellerPurchaseInvoiceLine[]
  vatGroups: SellerPurchaseInvoiceVatGroup[]
  grossAmount: Decimal
  couponShareAmount: Decimal
  commissionAmount: Decimal
  invoiceAmount: Decimal
  netAmount: Decimal
  vatAmount: Decimal
}

function cancelledShare(amount: Decimal, cancelledQuantity: number, quantity: number) {
  if (cancelledQuantity <= 0) return new Decimal(0)
  return roundMoney(amount.mul(cancelledQuantity).div(quantity))
}

/** Fatura tutarları kuruş hassasiyetinde gösterilir; satıcı bu tutarları faturasına aynen yazar. */
export function formatPurchaseInvoiceAmount(value: Decimal) {
  const amount = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(value.toFixed(2)))
  return `${amount} TL`
}

/** Oran gösterimi: 0.2000 → "%20", 0.1250 → "%12,5". */
export function formatPurchaseInvoiceRate(rate: Decimal) {
  return `%${new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(rate.mul(100).toFixed(2)))}`
}

/** KDV dahil tutarı matrah ve KDV'ye ayırır; KDV, kuruş farkı kalmasın diye farktan bulunur. */
export function splitVatInclusiveAmount(amount: Decimal, taxRate: Decimal) {
  const netAmount = roundMoney(amount.div(taxRate.plus(1)))
  return { netAmount, vatAmount: amount.minus(netAmount) }
}

export function calculateSellerPurchaseInvoice(
  lines: readonly SellerPurchaseInvoiceLineInput[],
): SellerPurchaseInvoice {
  const zero = new Decimal(0)
  const invoiceLines: SellerPurchaseInvoiceLine[] = []

  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) continue
    const cancelled = Math.min(Math.max(line.cancelledQuantity, 0), line.quantity)
    const quantity = line.quantity - cancelled
    if (quantity === 0) continue

    const grossAmount = line.totalPrice.minus(cancelledShare(line.totalPrice, cancelled, line.quantity))
    const couponShareAmount = line.couponDiscountAmount.minus(
      cancelledShare(line.couponDiscountAmount, cancelled, line.quantity),
    )
    const commissionAmount = line.commissionExemptedAt
      ? zero
      : line.commissionAmount.minus(cancelledShare(line.commissionAmount, cancelled, line.quantity))
    const invoiceAmount = grossAmount.minus(couponShareAmount).minus(commissionAmount)
    const { netAmount, vatAmount } = splitVatInclusiveAmount(invoiceAmount, line.taxRate)

    invoiceLines.push({
      orderLineId: line.id,
      productName: line.productName,
      variantName: line.variantName ?? null,
      quantity,
      taxRate: line.taxRate,
      grossAmount,
      couponShareAmount,
      commissionRate: line.commissionRate,
      commissionAmount,
      invoiceAmount,
      netAmount,
      vatAmount,
    })
  }

  const groups = new Map<string, SellerPurchaseInvoiceVatGroup>()
  for (const line of invoiceLines) {
    const key = line.taxRate.toFixed(4)
    const group = groups.get(key) ?? {
      taxRate: line.taxRate,
      invoiceAmount: zero,
      netAmount: zero,
      vatAmount: zero,
    }
    group.invoiceAmount = group.invoiceAmount.plus(line.invoiceAmount)
    group.netAmount = group.netAmount.plus(line.netAmount)
    group.vatAmount = group.vatAmount.plus(line.vatAmount)
    groups.set(key, group)
  }

  const sum = (pick: (line: SellerPurchaseInvoiceLine) => Decimal) =>
    invoiceLines.reduce((total, line) => total.plus(pick(line)), zero)

  return {
    lines: invoiceLines,
    vatGroups: [...groups.values()].sort((a, b) => b.taxRate.comparedTo(a.taxRate)),
    grossAmount: sum((line) => line.grossAmount),
    couponShareAmount: sum((line) => line.couponShareAmount),
    commissionAmount: sum((line) => line.commissionAmount),
    invoiceAmount: sum((line) => line.invoiceAmount),
    netAmount: sum((line) => line.netAmount),
    vatAmount: sum((line) => line.vatAmount),
  }
}
