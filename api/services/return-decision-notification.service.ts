import type { Prisma } from '@prisma/client'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { recordNotification } from './notification-outbox.service'

export async function recordFinalReturnDecision(
  tx: Prisma.TransactionClient,
  params: {
    id: string
    orderId: string
    sellerId: string | null
    approved: boolean
    resolution: string
    eventKey: string
    partialDecision?: boolean
  },
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: params.orderId },
    select: {
      publicNumber: true,
      customerId: true,
      customer: { select: { email: true } },
      lines: { select: { sellerId: true } },
    },
  })
  const orderNumber = formatOrderNumber(order.publicNumber, params.orderId)
  const decision = params.approved ? 'approved' : 'rejected'
  await recordNotification(tx, {
    eventKey: params.eventKey + ':customer',
    userId: order.customerId,
    emailTo: order.customer.email,
    type: 'return_status_changed',
    title: params.approved
      ? 'İadeniz Hanuja tarafından kabul edildi'
      : 'İadeniz Hanuja tarafından reddedildi',
    body: params.resolution,
    data: {
      orderId: params.orderId,
      returnRequestId: params.id,
      orderNumber,
      decision,
      partialDecision: params.partialDecision ?? false,
      stage: 'final_' + decision,
      resolution: params.resolution,
      orderUrl: getWebBaseUrl() + '/siparis/' + params.orderId,
    },
  })
  const sellerIds = params.sellerId
    ? [params.sellerId]
    : [...new Set(order.lines.map((line) => line.sellerId))]
  const sellers = await tx.seller.findMany({
    where: { id: { in: sellerIds } },
    select: { id: true, userId: true, user: { select: { email: true } } },
  })
  for (const seller of sellers)
    await recordNotification(tx, {
      eventKey: params.eventKey + ':seller:' + seller.id,
      userId: seller.userId,
      emailTo: seller.user.email,
      type: 'seller_return_decision',
      title: 'Hanuja iade kararı',
      body: 'İade Hanuja tarafından ' + (params.approved ? 'kabul edildi.' : 'reddedildi.'),
      data: {
        orderId: params.orderId,
        returnRequestId: params.id,
        orderNumber,
        sellerId: seller.id,
        decision,
        partialDecision: params.partialDecision ?? false,
        panelUrl: getSellerPanelUrl() + '/iadeler/' + params.id,
      },
    })
}
