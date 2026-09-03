import type { PrismaClient } from '@prisma/client'
import { formatMoney } from '@hanuja/security/money'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'

export async function enqueueRefundCompletedNotifications(
  prisma: PrismaClient,
  refundTransactionId: string,
) {
  const refund = await prisma.refundTransaction.findUnique({
    where: { id: refundTransactionId },
    include: {
      order: {
        select: {
          id: true,
          publicNumber: true,
          customerId: true,
          customer: { select: { email: true, name: true } },
        },
      },
      items: {
        include: {
          orderLine: {
            select: {
              sellerId: true,
              productName: true,
              variantName: true,
              unitPrice: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!refund || refund.status !== 'completed') return

  const seller = refund.sellerId
    ? await prisma.seller.findUnique({
        where: { id: refund.sellerId },
        select: {
          id: true,
          displayName: true,
          user: { select: { id: true, email: true } },
        },
      })
    : null

  const orderNumber = formatOrderNumber(refund.order.publicNumber, refund.order.id)
  const productItems = refund.items
    .filter((item) => item.orderLine)
    .map((item) => ({
      productName: item.orderLine!.productName,
      variantName: item.orderLine!.variantName,
      sellerId: item.orderLine!.sellerId,
      quantity: item.quantity ?? 1,
      unitPrice: formatMoney(item.orderLine!.unitPrice.toNumber()),
      lineTotal: formatMoney(item.amount.toNumber()),
    }))
  const customerItems = [
    ...productItems,
    ...refund.items
      .filter((item) => item.kind === 'shipping')
      .map((item) => ({
        productName: 'Kargo',
        variantName: null,
        quantity: 1,
        unitPrice: formatMoney(item.amount.toNumber()),
        lineTotal: formatMoney(item.amount.toNumber()),
      })),
  ]

  await enqueueNotification({
    eventKey: `refund:${refund.id}:customer:completed`,
    userId: refund.order.customerId,
    emailTo: refund.order.customer.email,
    type: 'refund_completed',
    title: 'İadeniz Tamamlandı',
    body: `${formatMoney(refund.customerAmount.toNumber())} tutarındaki iadeniz tamamlandı.`,
    data: {
      refundTransactionId: refund.id,
      orderId: refund.order.id,
      orderNumber,
      customerName: refund.order.customer.name ?? 'Değerli Müşterimiz',
      refundAmount: formatMoney(refund.customerAmount.toNumber()),
      orderUrl: `${getWebBaseUrl()}/siparis/${refund.order.id}`,
      items: customerItems,
    },
  })

  if (seller) {
    await enqueueNotification({
      eventKey: `refund:${refund.id}:seller:completed`,
      userId: seller.user.id,
      emailTo: seller.user.email,
      type: 'seller_refund_completed',
      title: 'İade Tamamlandı',
      body: `${orderNumber} numaralı siparişte iade kesinleşti.`,
      data: {
        refundTransactionId: refund.id,
        orderId: refund.order.id,
        orderNumber,
        sellerId: seller.id,
        sellerName: seller.displayName,
        refundAmount: formatMoney(refund.customerAmount.toNumber()),
        panelUrl: `${getSellerPanelUrl()}/siparisler/${refund.order.id}`,
        items: productItems.filter((item) => item.sellerId === seller.id),
      },
    })
  }
}
