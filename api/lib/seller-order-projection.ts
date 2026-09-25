import { maskCustomerName } from '@hanuja/security'
import { formatOrderDisplayNumber } from './order-number'

type SellerOrderCustomer = {
  name?: string | null
  email?: unknown
}

export type SellerOrderDtoInput = {
  customer?: SellerOrderCustomer | null | undefined
}

/**
 * Order-level finance/discount fields that reflect the customer's full order
 * (other sellers' lines, shipping, platform coupon, EFT channel discount,
 * admin EFT-approval discount) rather than this seller's own line amounts.
 * Sellers must never see these — see .claude/rules/09-seller-panel-rules.md
 * and .claude/rules/07-marketplace-finance-rules.md.
 */
const ORDER_LEVEL_FINANCE_FIELDS = [
  'totalAmount',
  'discountAmount',
  'eftDiscountAmount',
  'eftDiscountRateSnapshot',
  'grossAmount',
  'shippingAmount',
  'couponCode',
  'netSubtotal',
  'taxBreakdownJson',
] as const

type OrderLevelFinanceField = (typeof ORDER_LEVEL_FINANCE_FIELDS)[number]

function omitOrderLevelFinanceFields<T extends object>(order: T): Omit<T, OrderLevelFinanceField> {
  const sanitized = { ...order } as Record<string, unknown>
  for (const field of ORDER_LEVEL_FINANCE_FIELDS) {
    delete sanitized[field]
  }
  return sanitized as Omit<T, OrderLevelFinanceField>
}

export type SellerSafeOrderDto<T extends SellerOrderDtoInput> = Omit<
  T,
  'customer' | OrderLevelFinanceField
> & {
  customer: { name: string } | null | undefined
}

export type SellerOrderCsvRow = SellerOrderDtoInput & {
  id: string
  publicNumber?: number | string | null
  createdAt: Date
  status: string
  lines: Array<{
    quantity: number
    unitPrice: { toNumber(): number } | number
    product: { name: string } | null
  }>
}

/**
 * Removes account email defensively and masks the account holder's name.
 * Delivery recipient/address/phone are separate fields and intentionally
 * remain available for fulfilment.
 */
export function toSellerSafeOrderDto<T extends SellerOrderDtoInput>(
  order: T,
): SellerSafeOrderDto<T> {
  const sanitizedOrder = omitOrderLevelFinanceFields(order)

  if (!sanitizedOrder.customer) {
    return { ...sanitizedOrder, customer: sanitizedOrder.customer } as SellerSafeOrderDto<T>
  }

  const { email: _email, name, ...customer } = sanitizedOrder.customer
  return {
    ...sanitizedOrder,
    customer: {
      ...customer,
      name: maskCustomerName(name),
    },
  } as SellerSafeOrderDto<T>
}

export function toSellerSafeOrderDtos<T extends SellerOrderDtoInput>(
  orders: readonly T[],
): SellerSafeOrderDto<T>[] {
  return orders.map(toSellerSafeOrderDto)
}

type SellerOrderLineAmount = {
  quantity: number
  unitPrice: { toNumber(): number } | number
}

/**
 * Sums the seller's own order-line amounts (unit price × quantity). This is
 * the seller-safe "order total" — it never includes other sellers' lines,
 * shipping, or any order-level discount (platform coupon, EFT channel
 * discount). Used consistently across the seller orders list, CSV export,
 * and shipment list so the seller sees one definition of "their amount".
 */
export function calculateSellerOrderLinesTotal(lines: readonly SellerOrderLineAmount[]): number {
  return lines.reduce((sum, line) => {
    const price =
      typeof line.unitPrice === 'object' && 'toNumber' in line.unitPrice
        ? line.unitPrice.toNumber()
        : Number(line.unitPrice)
    return sum + price * line.quantity
  }, 0)
}

/** Serializes only seller-safe DTOs for the bulk order export. */
export function buildSellerOrderCsv(rows: readonly SellerOrderCsvRow[]) {
  const formatDate = (date: Date) =>
    new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  const formatAmount = (value: number) =>
    `${new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)} TL`
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`

  const header = ['Siparis No', 'Tarih', 'Musteri', 'Durum', 'Urunler', 'Toplam']
  const body = rows.map((order) => {
    const total = calculateSellerOrderLinesTotal(order.lines)
    const products = order.lines.map((line) => line.product?.name ?? 'Urun').join(', ')
    return [
      escape(formatOrderDisplayNumber(order.publicNumber, order.id)),
      escape(formatDate(new Date(order.createdAt))),
      escape(order.customer?.name ?? '-'),
      escape(order.status),
      escape(products),
      escape(formatAmount(total)),
    ].join(';')
  })

  return `\uFEFF${[header.map(escape).join(';'), ...body].join('\r\n')}`
}
