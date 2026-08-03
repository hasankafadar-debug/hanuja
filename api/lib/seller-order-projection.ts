import { maskCustomerName } from '@hanuja/security'
import { formatOrderDisplayNumber } from './order-number'

type SellerOrderCustomer = {
  name?: string | null
  email?: unknown
}

export type SellerOrderDtoInput = {
  customer?: SellerOrderCustomer | null | undefined
}

export type SellerSafeOrderDto<T extends SellerOrderDtoInput> = Omit<T, 'customer'> & {
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
  if (!order.customer) {
    return { ...order, customer: order.customer } as SellerSafeOrderDto<T>
  }

  const { email: _email, name, ...customer } = order.customer
  return {
    ...order,
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
    const total = order.lines.reduce((sum, line) => {
      const price =
        typeof line.unitPrice === 'object' && 'toNumber' in line.unitPrice
          ? line.unitPrice.toNumber()
          : Number(line.unitPrice)
      return sum + price * line.quantity
    }, 0)
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
