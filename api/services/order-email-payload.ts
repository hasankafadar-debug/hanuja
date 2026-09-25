/**
 * Builds the serialisable data blocks that customer/seller order e-mails render.
 * Producers call these inside their business transaction so the outbox record
 * is written from the same snapshot the transaction commits.
 */
import type { Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { formatMoney } from '@hanuja/security/money'
import { EMAIL_LINE_IMAGE_SELECT, toEmailOrderLine } from '../lib/email-line-items'
import type {
  EmailOrderLine,
  OrderAmountSummary,
  OrderContractLinks,
} from '../lib/email-templates/types'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { recordNotification } from './notification-outbox.service'

type OrderEmailClient = Pick<Prisma.TransactionClient, 'order'>

export const ORDER_EMAIL_INCLUDE = {
  customer: { select: { id: true, email: true, name: true } },
  address: { select: { fullName: true } },
  payments: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { method: true, status: true, eftDiscountAmount: true, confirmedAt: true },
  },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      sellerId: true,
      productName: true,
      variantName: true,
      quantity: true,
      cancelledQuantity: true,
      unitPrice: true,
      totalPrice: true,
      product: { select: EMAIL_LINE_IMAGE_SELECT },
      seller: {
        select: { id: true, displayName: true, user: { select: { id: true, email: true } } },
      },
    },
  },
} as const

export type OrderEmailSnapshot = Prisma.OrderGetPayload<{ include: typeof ORDER_EMAIL_INCLUDE }>

export function customerOrderUrl(orderId: string): string {
  return `${getWebBaseUrl()}/siparis/${orderId}`
}

export function sellerOrderPanelUrl(orderId: string): string {
  return `${getSellerPanelUrl()}/siparisler/${orderId}`
}

export function orderContractLinks(orderId: string): OrderContractLinks {
  const base = `${getWebBaseUrl()}/api/orders/${orderId}/documents/contracts`
  return {
    preInformationUrl: `${base}/pre-information?goruntule=1`,
    distanceSalesUrl: `${base}/distance-sales?goruntule=1`,
  }
}

export function customerDisplayName(order: {
  customer: { name: string | null }
  address?: { fullName: string | null } | null
}): string {
  return order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz'
}

function percentLabel(rate: Decimal | null | undefined): string | null {
  if (!rate || rate.lte(0)) return null
  return `%${rate.mul(100).toDecimalPlaces(2).toString().replace('.', ',')}`
}

export function orderAmountSummary(order: OrderEmailSnapshot): OrderAmountSummary {
  const manualDiscount = order.payments[0]?.eftDiscountAmount ?? null
  return {
    subtotal: formatMoney(order.grossAmount.toNumber()),
    ...(order.discountAmount.gt(0)
      ? {
          couponDiscount: formatMoney(order.discountAmount.toNumber()),
          couponCode: order.couponCode ?? null,
        }
      : {}),
    ...(order.eftDiscountAmount.gt(0)
      ? {
          eftDiscount: formatMoney(order.eftDiscountAmount.toNumber()),
          eftDiscountRate: percentLabel(order.eftDiscountRateSnapshot),
        }
      : {}),
    ...(manualDiscount && manualDiscount.gt(0)
      ? { additionalDiscount: formatMoney(manualDiscount.toNumber()) }
      : {}),
    shipping: order.shippingAmount.gt(0) ? formatMoney(order.shippingAmount.toNumber()) : 'Ücretsiz',
  }
}

export function activeOrderLines(order: OrderEmailSnapshot) {
  return order.lines.filter((line) => line.quantity - line.cancelledQuantity > 0)
}

export function customerOrderLines(order: OrderEmailSnapshot): EmailOrderLine[] {
  return activeOrderLines(order).map((line) =>
    toEmailOrderLine(line, line.quantity - line.cancelledQuantity, {
      lineTotal: line.totalPrice
        .div(line.quantity)
        .mul(line.quantity - line.cancelledQuantity),
    }),
  )
}

export async function loadOrderEmailSnapshot(
  client: OrderEmailClient,
  orderId: string,
): Promise<OrderEmailSnapshot | null> {
  return client.order.findUnique({ where: { id: orderId }, include: ORDER_EMAIL_INCLUDE })
}

/** Data block for the customer "Siparişiniz Alındı" / "Ödemeniz Onaylandı" e-mails. */
export function customerOrderEmailData(
  order: OrderEmailSnapshot,
  options: { paymentMethod: 'card' | 'eft'; paymentStatus: 'confirmed' | 'pending' },
) {
  return {
    orderId: order.id,
    orderNumber: formatOrderNumber(order.publicNumber, order.id),
    customerName: customerDisplayName(order),
    paymentMethod: options.paymentMethod,
    paymentStatus: options.paymentStatus,
    totalAmount: formatMoney(order.totalAmount.toNumber()),
    summary: orderAmountSummary(order),
    contracts: orderContractLinks(order.id),
    orderUrl: customerOrderUrl(order.id),
    items: customerOrderLines(order),
  }
}

/** Per-seller data blocks for "Yeni Sipariş"; only that seller's active lines are included. */
export function sellerOrderEmailData(order: OrderEmailSnapshot) {
  const orderNumber = formatOrderNumber(order.publicNumber, order.id)
  const bySeller = new Map<string, OrderEmailSnapshot['lines']>()
  for (const line of activeOrderLines(order)) {
    const bucket = bySeller.get(line.sellerId) ?? []
    bucket.push(line)
    bySeller.set(line.sellerId, bucket)
  }
  return [...bySeller.entries()].map(([sellerId, lines]) => {
    const seller = lines[0]!.seller
    return {
      sellerId,
      sellerUserId: seller.user.id,
      sellerEmail: seller.user.email,
      data: {
        orderId: order.id,
        orderNumber,
        sellerId,
        sellerName: seller.displayName,
        totalAmount: formatMoney(
          lines.reduce((sum, line) => sum.add(line.totalPrice), new Decimal(0)).toNumber(),
        ),
        panelUrl: sellerOrderPanelUrl(order.id),
        items: lines.map((line) =>
          toEmailOrderLine(line, line.quantity - line.cancelledQuantity, {
            lineTotal: line.totalPrice,
          }),
        ),
      },
    }
  })
}

type CancellationActor = 'customer' | 'seller' | 'admin' | 'system' | 'payment_failure'

/**
 * Whole-order cancellation notifications (admin cancel, 20-day breach, legacy
 * customer cancel / seller rejection). Lists every still-active line. The
 * refund amount is shown only when a confirmed payment exists.
 */
export async function recordWholeOrderCancellationNotifications(
  tx: Pick<Prisma.TransactionClient, 'order' | 'notificationOutbox'>,
  orderId: string,
  options: { actorRole: CancellationActor; reason?: string; eventSuffix: string },
) {
  const order = await loadOrderEmailSnapshot(tx, orderId)
  if (!order) return
  const orderNumber = formatOrderNumber(order.publicNumber, order.id)
  const items = customerOrderLines(order)
  if (items.length === 0) return
  const paymentConfirmed = order.payments[0]?.status === 'confirmed'
  // Never collected: the seller never saw the order and no refund is owed.
  const paymentCollected = order.payments.some((payment) => payment.confirmedAt !== null)
  const paymentMethod = order.payments[0]?.method ?? null
  const summary = items.map((item) => `${item.productName} (${item.quantity})`).join(', ')
  const base = {
    orderId: order.id,
    orderNumber,
    customerName: customerDisplayName(order),
    actorRole: options.actorRole,
    partial: false,
    ...(options.reason ? { cancellationReason: options.reason } : {}),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(paymentConfirmed ? { refundAmount: formatMoney(order.totalAmount.toNumber()) } : {}),
    ...(!paymentCollected && paymentMethod === 'eft' ? { paymentNotCollected: true } : {}),
    orderUrl: customerOrderUrl(order.id),
  }
  await recordNotification(tx, {
    eventKey: `order:${order.id}:cancelled:${options.eventSuffix}`,
    userId: order.customerId,
    ...(order.customer.email ? { emailTo: order.customer.email } : {}),
    type: 'order_cancelled',
    title: 'Siparişiniz iptal edildi',
    body: summary,
    data: { ...base, items },
  })
  if (options.actorRole === 'seller' || !paymentCollected) return
  for (const seller of sellerOrderEmailData(order)) {
    await recordNotification(tx, {
      eventKey: `order:${order.id}:cancelled:${options.eventSuffix}:seller:${seller.sellerId}`,
      userId: seller.sellerUserId,
      emailTo: seller.sellerEmail,
      type: 'order_canceled',
      title: 'Siparişiniz iptal edildi',
      body: summary,
      data: {
        ...base,
        sellerId: seller.sellerId,
        sellerName: seller.data.sellerName,
        panelUrl: seller.data.panelUrl,
        items: seller.data.items,
      },
    })
  }
}
