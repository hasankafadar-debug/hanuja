import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import {
  allocateProductRefund,
  isQuantityFullyClosed,
} from '../domain/quantity-allocation'
import { createQuantityRefundService } from './quantity-refund.service'
import { recordNotification } from './notification-outbox.service'
import {
  adminPanelLink,
  recordAdminOperationNotification,
} from './admin-notification.service'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { formatMoney } from '@hanuja/security/money'
import { resolveEmailImageUrl } from '../lib/email-line-items'

interface CancellationSelection {
  orderLineId: string
  quantity: number
}

function assertSelections(items: CancellationSelection[]) {
  if (items.length === 0) throw new ValidationError('En az bir ürün seçin')
  const ids = new Set<string>()
  for (const item of items) {
    if (
      !item.orderLineId ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new ValidationError('İptal adetleri pozitif tam sayı olmalı')
    }
    if (ids.has(item.orderLineId))
      throw new ValidationError('Aynı sipariş satırı iki kez seçilemez')
    ids.add(item.orderLineId)
  }
}

const ADMIN_CANCELLATION_ACTOR_LABELS: Record<
  'customer' | 'seller' | 'admin',
  string
> = {
  customer: 'Müşteri',
  seller: 'Satıcı',
  admin: 'Yönetim',
}

export function createQuantityCancellationService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  const refunds = createQuantityRefundService({ prisma })

  async function create(params: {
    orderId: string
    customerId: string
    reason: string
    idempotencyKey?: string
    actorId?: string
    /** Who triggered the cancellation; drives the wording of the customer/seller e-mails. */
    actorRole?: 'customer' | 'seller' | 'admin'
    fullCancellationStatus?:
      | 'cancelled_by_customer'
      | 'cancelled_due_to_seller_rejection'
    items: CancellationSelection[]
  }) {
    assertSelections(params.items)
    if (params.reason.trim().length < 3)
      throw new ValidationError('İptal nedeni en az 3 karakter olmalı')

    const operations = await prisma
      .$transaction((tx) => createInTransaction(tx, params), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
      .catch((error) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2034'
        ) {
          throw new ConflictError(
            'İptal ile kargoya verme işlemi çakıştı; güncel durumu yenileyin',
          )
        }
        throw error
      })

    const queued: Array<Awaited<ReturnType<typeof refunds.queue>>> = []
    for (const operation of operations) {
      queued.push(
        await refunds.queue({
          orderId: params.orderId,
          sellerId: operation.sellerId,
          sourceType: 'cancellation',
          sourceId: operation.id,
          customerAmount: operation.customerRefundAmount,
          grossProductAmount: operation.grossProductAmount,
          couponAdjustmentAmount: operation.couponAdjustmentAmount,
          sellerAdjustmentAmount: operation.sellerAdjustmentAmount,
          commissionAdjustmentAmount: operation.commissionAdjustmentAmount,
          platformFundedAmount: Decimal.max(
            new Decimal(0),
            operation.customerRefundAmount
              .sub(operation.sellerAdjustmentAmount)
              .sub(operation.commissionAdjustmentAmount),
          ),
          items: operation.items.map((item) => ({
            orderLineId: item.orderLineId,
            quantity: item.quantity,
            amount: item.customerRefundAmount,
          })),
          shippingAmount: operation.shippingRefundAmount,
        }),
      )
    }

    return operations.map((operation, index) => ({
      ...operation,
      refundTransaction: queued[index],
    }))
  }

  /**
   * Customer / seller / admin notifications for the cancellation operations
   * created in this transaction. Written through the same client so they roll
   * back with the business change.
   */
  async function recordCancellationNotifications(
    tx: Prisma.TransactionClient,
    order: {
      id: string
      publicNumber: number
      customerId: string
      customer: { email: string | null; name: string | null }
      address: { fullName: string | null } | null
      payments: Array<{ method: 'card' | 'eft' }>
      lines: Array<{ id: string; productId: string; quantity: number }>
    },
    operations: Array<{
      id: string
      sellerId: string
      reason: string
      customerRefundAmount: Decimal
      items: Array<{
        quantity: number
        orderLine: {
          id: string
          productId: string
          productName: string
          variantName: string | null
          unitPrice: Decimal
        }
      }>
    }>,
    context: { actorRole: 'customer' | 'seller' | 'admin'; actorId?: string },
  ) {
    if (operations.length === 0) return
    const sellerIds = [...new Set(operations.map((operation) => operation.sellerId))]
    const productIds = [
      ...new Set(
        operations.flatMap((operation) =>
          operation.items.map((item) => item.orderLine.productId),
        ),
      ),
    ]
    const [sellers, admins, images] = await Promise.all([
      tx.seller.findMany({
        where: { id: { in: sellerIds } },
        select: {
          id: true,
          displayName: true,
          user: { select: { id: true, email: true } },
        },
      }),
      tx.user.findMany({ where: { role: 'admin' }, select: { id: true } }),
      tx.productImage.findMany({
        where: { productId: { in: productIds } },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        select: { productId: true, url: true, isPrimary: true, sortOrder: true },
      }),
    ])
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]))
    const imagesByProduct = new Map<string, typeof images>()
    for (const image of images) {
      const bucket = imagesByProduct.get(image.productId) ?? []
      bucket.push(image)
      imagesByProduct.set(image.productId, bucket)
    }
    const orderNumber = formatOrderNumber(order.publicNumber, order.id)
    const customerName =
      order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz'
    const totalOrderedQuantity = order.lines.reduce((sum, line) => sum + line.quantity, 0)
    const cancelledNow = operations.reduce(
      (sum, operation) =>
        sum + operation.items.reduce((inner, item) => inner + item.quantity, 0),
      0,
    )
    const partial = cancelledNow < totalOrderedQuantity
    const paymentMethod = order.payments[0]?.method ?? 'card'

    for (const operation of operations) {
      const items = operation.items.map((item) => ({
        productName: item.orderLine.productName,
        variantName: item.orderLine.variantName,
        sellerId: operation.sellerId,
        quantity: item.quantity,
        unitPrice: formatMoney(item.orderLine.unitPrice.toNumber()),
        lineTotal: formatMoney(
          item.orderLine.unitPrice.mul(item.quantity).toNumber(),
        ),
        imageUrl: resolveEmailImageUrl(imagesByProduct.get(item.orderLine.productId)),
      }))
      const summary = items
        .map((item) => `${item.productName} (${item.quantity})`)
        .join(', ')
      const data = {
        operationId: operation.id,
        orderId: order.id,
        orderNumber,
        customerName,
        sellerId: operation.sellerId,
        actorRole: context.actorRole,
        partial,
        paymentMethod,
        cancellationReason: operation.reason,
        refundAmount: formatMoney(operation.customerRefundAmount.toNumber()),
        orderUrl: `${getWebBaseUrl()}/siparis/${order.id}`,
        items,
      }
      await recordNotification(tx, {
        eventKey: `cancellation:${operation.id}:customer`,
        userId: order.customerId,
        ...(order.customer.email ? { emailTo: order.customer.email } : {}),
        type: 'order_cancelled',
        title: partial ? 'Siparişinizin bir kısmı iptal edildi' : 'Siparişiniz iptal edildi',
        body: summary,
        data,
      })
      const seller = sellerById.get(operation.sellerId)
      // A seller rejecting their own lines already knows; only mail sellers when
      // someone else cancelled.
      if (seller && context.actorRole !== 'seller') {
        await recordNotification(tx, {
          eventKey: `cancellation:${operation.id}:seller`,
          userId: seller.user.id,
          emailTo: seller.user.email,
          type: 'order_canceled',
          title: 'Siparişinizde adet iptali var',
          body: summary,
          data: {
            ...data,
            sellerName: seller.displayName,
            panelUrl: `${getSellerPanelUrl()}/siparisler/${order.id}`,
          },
        })
      }
      for (const admin of admins) {
        await recordNotification(tx, {
          eventKey: `cancellation:${operation.id}:admin`,
          userId: admin.id,
          type: 'order_canceled',
          title: 'Adet bazlı iptal oluşturuldu',
          body: summary,
          data,
        })
      }
      // One e-mail to the operations mailbox, whatever the number of admins.
      await recordAdminOperationNotification(tx, {
        event: 'order_cancellation',
        type: 'admin_order_cancellation',
        eventKey: `cancellation:${operation.id}:ops`,
        title: 'Adet bazlı iptal oluşturuldu',
        body: summary,
        data: {
          orderNumber,
          adminUrl: adminPanelLink(`/siparisler/${order.id}`),
          actorLabel: ADMIN_CANCELLATION_ACTOR_LABELS[context.actorRole],
          customerName,
          sellerName: sellerById.get(operation.sellerId)?.displayName,
          refundAmount: formatMoney(operation.customerRefundAmount.toNumber()),
          reason: operation.reason,
          items,
        },
      })
    }
  }

  async function createInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string
      customerId: string
      reason: string
      idempotencyKey?: string
      actorId?: string
      actorRole?: 'customer' | 'seller' | 'admin'
      fullCancellationStatus?:
        | 'cancelled_by_customer'
        | 'cancelled_due_to_seller_rejection'
      items: CancellationSelection[]
    },
  ) {
    if (params.idempotencyKey) {
      const existing = await tx.orderCancellation.findMany({
        where: {
          orderId: params.orderId,
          customerId: params.customerId,
          requestKey: params.idempotencyKey,
        },
        include: { items: { include: { orderLine: true } } },
        orderBy: { createdAt: 'asc' },
      })
      if (existing.length > 0) return existing
    }
    const order = await tx.order.findFirst({
      where: { id: params.orderId, customerId: params.customerId },
      include: {
        lines: true,
        payments: true,
        customer: { select: { email: true, name: true } },
        address: { select: { fullName: true } },
      },
    })
    if (!order) throw new NotFoundError('Order', params.orderId)
    if (order.quantityLifecycleVersion !== 2) {
      throw new ConflictError('Bu sipariş eski iptal akışını kullanıyor')
    }

    const requestedById = new Map(
      params.items.map((item) => [item.orderLineId, item.quantity]),
    )
    const selectedLines = order.lines.filter((line) =>
      requestedById.has(line.id),
    )
    if (selectedLines.length !== params.items.length) {
      throw new ValidationError('Seçilen ürünlerden biri bu siparişe ait değil')
    }

    const bySeller = new Map<string, typeof selectedLines>()
    for (const line of selectedLines) {
      const requested = requestedById.get(line.id)!
      const cancellable =
        line.quantity - line.cancelledQuantity - line.shippedQuantity
      if (requested > cancellable) {
        throw new ConflictError(
          `"${line.productName}" için en fazla ${Math.max(0, cancellable)} adet iptal edilebilir`,
        )
      }
      const rows = bySeller.get(line.sellerId) ?? []
      rows.push(line)
      bySeller.set(line.sellerId, rows)
    }

    const created = []
    for (const [sellerId, lines] of bySeller) {
      let customerRefundAmount = new Decimal(0)
      let grossProductAmount = new Decimal(0)
      let couponAdjustmentAmount = new Decimal(0)
      let sellerAdjustmentAmount = new Decimal(0)
      let commissionAdjustmentAmount = new Decimal(0)
      const itemData = []

      for (const line of lines) {
        const quantity = requestedById.get(line.id)!
        const consumed = line.cancelledQuantity + line.returnClaimedQuantity
        const {
          customerAmount,
          grossAmount,
          couponAmount,
          sellerAmount,
          commissionAmount,
        } = allocateProductRefund(line, consumed, quantity)

        const updated = await tx.orderLine.updateMany({
          where: {
            id: line.id,
            cancelledQuantity: line.cancelledQuantity,
            shippedQuantity: line.shippedQuantity,
          },
          data: { cancelledQuantity: { increment: quantity } },
        })
        if (updated.count !== 1) {
          throw new ConflictError(
            'Ürün kargoya verilmiş veya başka bir iptal işlemi yapılmış',
          )
        }

        if (line.variantId) {
          await tx.productVariant.update({
            where: { id: line.variantId },
            data: { stockQuantity: { increment: quantity } },
          })
        } else {
          await tx.product.update({
            where: { id: line.productId },
            data: { stockQuantity: { increment: quantity } },
          })
        }

        customerRefundAmount = customerRefundAmount.add(customerAmount)
        grossProductAmount = grossProductAmount.add(grossAmount)
        couponAdjustmentAmount = couponAdjustmentAmount.add(couponAmount)
        sellerAdjustmentAmount = sellerAdjustmentAmount.add(sellerAmount)
        commissionAdjustmentAmount =
          commissionAdjustmentAmount.add(commissionAmount)
        itemData.push({
          orderLineId: line.id,
          quantity,
          customerRefundAmount: customerAmount,
          grossProductAmount: grossAmount,
          couponAdjustmentAmount: couponAmount,
          sellerAdjustmentAmount: sellerAmount,
          commissionAdjustmentAmount: commissionAmount,
        })
      }

      created.push(
        await tx.orderCancellation.create({
          data: {
            orderId: order.id,
            sellerId,
            customerId: params.customerId,
            ...(params.idempotencyKey
              ? { requestKey: params.idempotencyKey }
              : {}),
            reason: params.reason.trim(),
            customerRefundAmount,
            grossProductAmount,
            couponAdjustmentAmount,
            sellerAdjustmentAmount,
            commissionAdjustmentAmount,
            items: { create: itemData },
          },
          include: { items: { include: { orderLine: true } } },
        }),
      )

      const sellerLinesAfter = await tx.orderLine.findMany({
        where: { orderId: order.id, sellerId },
        select: { quantity: true, cancelledQuantity: true },
      })
      if (
        sellerLinesAfter.length > 0 &&
        sellerLinesAfter.every(
          (line) => line.cancelledQuantity === line.quantity,
        )
      ) {
        await tx.orderSellerFulfillment.updateMany({
          where: {
            orderId: order.id,
            sellerId,
            status: {
              notIn: [
                'shipped',
                'delivered',
                'delivery_confirmation_pending',
                'delivery_confirmed',
              ],
            },
          },
          data: { status: 'cancelled' },
        })
      }
    }

    const remaining = await tx.orderLine.aggregate({
      where: { orderId: order.id },
      _sum: { quantity: true, cancelledQuantity: true },
    })
    const acceptedReturns = await tx.returnRequestItem.aggregate({
      where: { orderLine: { orderId: order.id } },
      _sum: { acceptedQuantity: true },
    })
    const disputeResolvedReturns = await tx.returnRequestItem.aggregate({
      where: {
        orderLine: { orderId: order.id },
        returnRequest: {
          escalatedDispute: { is: { status: 'resolved_for_customer' } },
        },
      },
      _sum: { rejectedQuantity: true },
    })
    const totalQuantity = remaining._sum.quantity ?? 0
    const cancelledQuantity = remaining._sum.cancelledQuantity ?? 0
    const acceptedReturnQuantity =
      (acceptedReturns._sum.acceptedQuantity ?? 0) +
      (disputeResolvedReturns._sum.rejectedQuantity ?? 0)
    const isFullyCancelled =
      totalQuantity > 0 && totalQuantity === cancelledQuantity
    const fullCancellationStatus =
      params.fullCancellationStatus ?? 'cancelled_by_customer'
    const isFullyClosed = isQuantityFullyClosed({
      originalQuantity: totalQuantity,
      cancelledQuantity,
      acceptedReturnQuantity,
    })

    if (isFullyClosed && created.length > 0) {
      const shippingRefund = order.shippingAmount.sub(
        order.refundedShippingAmount,
      )
      if (shippingRefund.gt(0)) {
        const last = created[created.length - 1]!
        const updated = await tx.orderCancellation.update({
          where: { id: last.id },
          data: {
            shippingRefundAmount: shippingRefund,
            customerRefundAmount: { increment: shippingRefund },
          },
          include: { items: { include: { orderLine: true } } },
        })
        created[created.length - 1] = updated
        await tx.order.update({
          where: { id: order.id },
          data: {
            ...(isFullyCancelled
              ? {
                  status: fullCancellationStatus,
                  cancelledAt: new Date(),
                  cancellationReason:
                    fullCancellationStatus ===
                    'cancelled_due_to_seller_rejection'
                      ? ('seller_rejected' as const)
                      : ('customer_requested' as const),
                }
              : {}),
            refundedShippingAmount: { increment: shippingRefund },
          },
        })
      } else if (isFullyCancelled) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: fullCancellationStatus,
            cancelledAt: new Date(),
            cancellationReason:
              fullCancellationStatus === 'cancelled_due_to_seller_rejection'
                ? 'seller_rejected'
                : 'customer_requested',
          },
        })
      }
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: isFullyCancelled ? fullCancellationStatus : order.status,
        actorId: params.actorId ?? params.customerId,
        reason: `Adet bazlı iptal: ${params.items.reduce((sum, item) => sum + item.quantity, 0)} adet — ${params.reason.trim()}`,
      },
    })

    await recordCancellationNotifications(tx, order, created, {
      actorRole:
        params.actorRole ??
        (params.fullCancellationStatus === 'cancelled_due_to_seller_rejection'
          ? 'seller'
          : 'customer'),
      ...(params.actorId ? { actorId: params.actorId } : {}),
    })

    return created
  }

  // recordCancellationNotifications is exposed for unit tests of the e-mail payloads.
  return { create, recordCancellationNotifications }
}

export type QuantityCancellationService = ReturnType<
  typeof createQuantityCancellationService
>
