import type { PrismaClient } from '@prisma/client'
import { formatMoney } from '@hanuja/security/money'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { formatOrderNumber } from '../lib/order-number'
import { getWebBaseUrl } from '../lib/platform-info'
import { EMAIL_LINE_IMAGE_SELECT, resolveEmailImageUrl } from '../lib/email-line-items'

export async function enqueueCustomerRefundCompletedNotification(
  prisma: PrismaClient,
  refundTransactionId: string,
) {
  const refund = await prisma.refundTransaction.findUnique({
    where: { id: refundTransactionId },
    include: {
      payment: { select: { method: true } },
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
              productName: true,
              variantName: true,
              unitPrice: true,
              product: { select: EMAIL_LINE_IMAGE_SELECT },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!refund || refund.status !== 'completed') return

  const orderNumber = formatOrderNumber(refund.order.publicNumber, refund.order.id)
  const productItems = refund.items
    .filter((item) => item.orderLine)
    .map((item) => ({
      productName: item.orderLine!.productName,
      variantName: item.orderLine!.variantName,
      quantity: item.quantity ?? 1,
      unitPrice: formatMoney(item.orderLine!.unitPrice.toNumber()),
      lineTotal: formatMoney(item.amount.toNumber()),
      imageUrl: resolveEmailImageUrl(item.orderLine!.product?.images),
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
    title: 'Geri ödemeniz yapıldı',
    body: `${formatMoney(refund.customerAmount.toNumber())} tutarındaki geri ödemeniz yapıldı.`,
    data: {
      refundTransactionId: refund.id,
      orderId: refund.order.id,
      orderNumber,
      customerName: refund.order.customer.name ?? 'Değerli Müşterimiz',
      ...(refund.payment ? { paymentMethod: refund.payment.method } : {}),
      refundAmount: formatMoney(refund.customerAmount.toNumber()),
      orderUrl: `${getWebBaseUrl()}/siparis/${refund.order.id}`,
      items: customerItems,
    },
  })
}
