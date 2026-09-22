import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../lib/errors'
import {
  allocateProductRefund,
  isQuantityFullyClosed,
} from '../domain/quantity-allocation'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { createQuantityRefundService } from './quantity-refund.service'
import { recordNotification } from './notification-outbox.service'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { formatMoney } from '@hanuja/security/money'
import { resolveEmailImageUrl } from '../lib/email-line-items'

interface ReturnSelection {
  orderLineId: string
  quantity: number
}

interface ReceiptDecision {
  returnRequestItemId: string
  acceptedQuantity: number
  rejectedQuantity: number
  rejectionReason?: string | undefined
}

function validateSelections(items: ReturnSelection[]) {
  if (items.length === 0) throw new ValidationError('En az bir ürün seçin')
  const seen = new Set<string>()
  for (const item of items) {
    if (
      !item.orderLineId ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new ValidationError('İade adetleri pozitif tam sayı olmalı')
    }
    if (seen.has(item.orderLineId))
      throw new ValidationError('Aynı sipariş satırı iki kez seçilemez')
    seen.add(item.orderLineId)
  }
}

function isRetryable(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  )
}

export function createQuantityReturnService({
  prisma,
}: {
  prisma: PrismaClient
}) {
  const refunds = createQuantityRefundService({ prisma })

  async function openRequest(params: {
    orderId: string
    customerId: string
    reason: string
    idempotencyKey?: string
    description?: string
    evidenceAssetIds?: string[]
    items: ReturnSelection[]
  }) {
    validateSelections(params.items)
    if (params.reason.trim().length < 3)
      throw new ValidationError('İade nedeni en az 3 karakter olmalı')

    let attempts = 0
    let operations: Awaited<ReturnType<typeof openInTransaction>> | undefined
    while (!operations && attempts < 3) {
      attempts += 1
      try {
        operations = await prisma.$transaction(
          (tx) => openInTransaction(tx, params),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
      } catch (error) {
        if (attempts < 3 && isRetryable(error)) continue
        throw error
      }
    }
    if (!operations)
      throw new ConflictError(
        'İade talebi eşzamanlı güncelleme nedeniyle tamamlanamadı',
      )

    if (params.evidenceAssetIds?.length && operations[0]) {
      await prisma.mediaAsset.updateMany({
        where: {
          id: { in: params.evidenceAssetIds },
          uploadedBy: params.customerId,
        },
        data: { returnRequestId: operations[0].id, type: 'return_evidence' },
      })
    }

    return operations
  }

  async function loadProductImages(tx: Prisma.TransactionClient, productIds: string[]) {
    const images = await tx.productImage.findMany({
      where: { productId: { in: [...new Set(productIds)] } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      select: { productId: true, url: true, isPrimary: true, sortOrder: true },
    })
    const byProduct = new Map<string, typeof images>()
    for (const image of images) {
      const bucket = byProduct.get(image.productId) ?? []
      bucket.push(image)
      byProduct.set(image.productId, bucket)
    }
    return byProduct
  }

  /**
   * Customer / seller / admin notifications for the return requests created in
   * this transaction (one request per seller).
   */
  async function recordReturnOpenedNotifications(
    tx: Prisma.TransactionClient,
    order: {
      id: string
      publicNumber: number
      customerId: string
      customer: { email: string | null; name: string | null }
      address: { fullName: string | null } | null
    },
    operations: Array<{
      id: string
      sellerId: string | null
      reason: string
      items: Array<{
        requestedQuantity: number
        orderLine: {
          productId: string
          productName: string
          variantName: string | null
          unitPrice: Decimal
        }
      }>
    }>,
  ) {
    if (operations.length === 0) return
    const sellerIds = operations
      .map((operation) => operation.sellerId)
      .filter((sellerId): sellerId is string => Boolean(sellerId))
    const [sellers, admins, imagesByProduct] = await Promise.all([
      tx.seller.findMany({
        where: { id: { in: sellerIds } },
        select: {
          id: true,
          displayName: true,
          user: { select: { id: true, email: true } },
        },
      }),
      tx.user.findMany({ where: { role: 'admin' }, select: { id: true } }),
      loadProductImages(
        tx,
        operations.flatMap((operation) =>
          operation.items.map((item) => item.orderLine.productId),
        ),
      ),
    ])
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]))
    const orderNumber = formatOrderNumber(order.publicNumber, order.id)
    const customerName =
      order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz'
    for (const operation of operations) {
      const items = operation.items.map((item) => ({
        productName: item.orderLine.productName,
        variantName: item.orderLine.variantName,
        sellerId: operation.sellerId ?? undefined,
        quantity: item.requestedQuantity,
        unitPrice: formatMoney(item.orderLine.unitPrice.toNumber()),
        lineTotal: formatMoney(
          item.orderLine.unitPrice.mul(item.requestedQuantity).toNumber(),
        ),
        imageUrl: resolveEmailImageUrl(imagesByProduct.get(item.orderLine.productId)),
      }))
      const summary = items
        .map((item) => `${item.productName} (${item.quantity})`)
        .join(', ')
      const data = {
        operationId: operation.id,
        returnRequestId: operation.id,
        orderId: order.id,
        orderNumber,
        customerName,
        sellerId: operation.sellerId,
        returnReason: operation.reason,
        orderUrl: `${getWebBaseUrl()}/siparis/${order.id}`,
        items,
      }
      await recordNotification(tx, {
        eventKey: `return:${operation.id}:customer:requested`,
        userId: order.customerId,
        ...(order.customer.email ? { emailTo: order.customer.email } : {}),
        type: 'return_requested',
        title: 'İade talebiniz alındı',
        body: summary,
        data,
      })
      if (operation.sellerId) {
        const seller = sellerById.get(operation.sellerId)
        if (seller) {
          await recordNotification(tx, {
            eventKey: `return:${operation.id}:seller:requested`,
            userId: seller.user.id,
            emailTo: seller.user.email,
            type: 'seller_return_request',
            title: 'Yeni adet bazlı iade talebi',
            body: summary,
            data: {
              ...data,
              sellerName: seller.displayName,
              panelUrl: `${getSellerPanelUrl()}/iadeler/${operation.id}`,
            },
          })
        }
      }
      for (const admin of admins) {
        await recordNotification(tx, {
          eventKey: `return:${operation.id}:admin:requested`,
          userId: admin.id,
          type: 'return_requested',
          title: 'Yeni adet bazlı iade talebi',
          body: summary,
          data,
        })
      }
    }
  }

  /** Line-level receipt decision e-mail (approved / partially approved / rejected). */
  async function recordReturnDecisionNotification(
    tx: Prisma.TransactionClient,
    request: {
      id: string
      orderId: string
      customerId: string
      items: Array<{
        id: string
        requestedQuantity: number
        orderLine: {
          productId: string
          productName: string
          variantName: string | null
          unitPrice: Decimal
        }
      }>
    },
    decisions: Array<{
      returnRequestItemId: string
      acceptedQuantity: number
      rejectedQuantity: number
      rejectionReason?: string | undefined
    }>,
    outcome: { refundAmount: Decimal; disputeOpened: boolean },
  ) {
    const order = await tx.order.findUnique({
      where: { id: request.orderId },
      select: {
        id: true,
        publicNumber: true,
        customer: { select: { email: true, name: true } },
        address: { select: { fullName: true } },
      },
    })
    if (!order) return
    const imagesByProduct = await loadProductImages(
      tx,
      request.items.map((item) => item.orderLine.productId),
    )
    const decisionById = new Map(
      decisions.map((decision) => [decision.returnRequestItemId, decision]),
    )
    const items = request.items.map((item) => {
      const decision = decisionById.get(item.id)
      return {
        productName: item.orderLine.productName,
        variantName: item.orderLine.variantName,
        quantity: item.requestedQuantity,
        unitPrice: formatMoney(item.orderLine.unitPrice.toNumber()),
        lineTotal: formatMoney(
          item.orderLine.unitPrice.mul(item.requestedQuantity).toNumber(),
        ),
        imageUrl: resolveEmailImageUrl(imagesByProduct.get(item.orderLine.productId)),
        acceptedQuantity: decision?.acceptedQuantity ?? 0,
        rejectedQuantity: decision?.rejectedQuantity ?? 0,
        rejectionReason: decision?.rejectionReason?.trim() || null,
      }
    })
    const accepted = items.reduce((sum, item) => sum + item.acceptedQuantity, 0)
    const rejected = items.reduce((sum, item) => sum + item.rejectedQuantity, 0)
    const decision = rejected === 0 ? 'approved' : accepted === 0 ? 'rejected' : 'partial'
    await recordNotification(tx, {
      eventKey: `return:${request.id}:customer:decision`,
      userId: request.customerId,
      ...(order.customer.email ? { emailTo: order.customer.email } : {}),
      type: decision === 'rejected' ? 'order_return_rejected' : 'order_return_approved',
      title:
        decision === 'approved'
          ? 'İadeniz kabul edildi'
          : decision === 'partial'
            ? 'İadeniz kısmen kabul edildi'
            : 'İadeniz reddedildi — uyuşmazlık açıldı',
      body:
        decision === 'rejected'
          ? items
              .filter((item) => item.rejectedQuantity > 0)
              .map((item) => `${item.productName}: ${item.rejectionReason ?? 'gerekçe belirtilmedi'}`)
              .join(', ')
          : `${formatMoney(outcome.refundAmount.toNumber())} geri ödeme kuyruğuna alındı`,
      data: {
        operationId: request.id,
        returnRequestId: request.id,
        orderId: order.id,
        orderNumber: formatOrderNumber(order.publicNumber, order.id),
        customerName:
          order.customer.name?.trim() || order.address?.fullName?.trim() || 'Değerli Müşterimiz',
        decision,
        disputeOpened: outcome.disputeOpened,
        ...(outcome.refundAmount.gt(0)
          ? { refundAmount: formatMoney(outcome.refundAmount.toNumber()) }
          : {}),
        orderUrl: `${getWebBaseUrl()}/siparis/${order.id}`,
        items,
      },
    })
  }

  async function openInTransaction(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string
      customerId: string
      reason: string
      idempotencyKey?: string
      description?: string
      items: ReturnSelection[]
    },
  ) {
    if (params.idempotencyKey) {
      const existing = await tx.returnRequest.findMany({
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
        customer: { select: { email: true, name: true } },
        address: { select: { fullName: true } },
      },
    })
    if (!order) throw new NotFoundError('Order', params.orderId)
    if (order.quantityLifecycleVersion !== 2)
      throw new ConflictError('Bu sipariş eski iade akışını kullanıyor')

    const requestedById = new Map(
      params.items.map((item) => [item.orderLineId, item.quantity]),
    )
    const selected = order.lines.filter((line) => requestedById.has(line.id))
    if (selected.length !== params.items.length)
      throw new ValidationError('Seçilen ürün siparişe ait değil')

    const bySeller = new Map<string, typeof selected>()
    for (const line of selected) {
      if (
        !line.deliveryConfirmedAt ||
        !isWithinReturnWindow(line.deliveryConfirmedAt)
      ) {
        throw new ConflictError(
          `"${line.productName}" için 14 günlük iade süresi açık değil`,
        )
      }
      const requested = requestedById.get(line.id)!
      const eligible = line.shippedQuantity - line.returnClaimedQuantity
      if (requested > eligible) {
        throw new ConflictError(
          `"${line.productName}" için en fazla ${Math.max(0, eligible)} adet iade edilebilir`,
        )
      }
      const rows = bySeller.get(line.sellerId) ?? []
      rows.push(line)
      bySeller.set(line.sellerId, rows)
    }

    const created = []
    for (const [sellerId, lines] of bySeller) {
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
            returnClaimedQuantity: line.returnClaimedQuantity,
          },
          data: { returnClaimedQuantity: { increment: quantity } },
        })
        if (updated.count !== 1)
          throw new ConflictError('Ürün için başka bir iade talebi oluşturuldu')
        itemData.push({
          orderLineId: line.id,
          requestedQuantity: quantity,
          requestedCustomerAmount: customerAmount,
          requestedGrossProductAmount: grossAmount,
          requestedCouponAdjustmentAmount: couponAmount,
          requestedSellerAdjustmentAmount: sellerAmount,
          requestedCommissionAdjustmentAmount: commissionAmount,
        })
      }

      created.push(
        await tx.returnRequest.create({
          data: {
            orderId: order.id,
            customerId: params.customerId,
            sellerId,
            ...(params.idempotencyKey
              ? { requestKey: params.idempotencyKey }
              : {}),
            reason: params.reason.trim(),
            ...(params.description !== undefined
              ? { description: params.description }
              : {}),
            isWithinWindow: true,
            items: { create: itemData },
          },
          include: { items: { include: { orderLine: true } } },
        }),
      )
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: order.status,
        actorId: params.customerId,
        reason: `Adet bazlı iade talebi: ${params.items.reduce((sum, item) => sum + item.quantity, 0)} adet`,
      },
    })
    await recordReturnOpenedNotifications(tx, order, created)
    return created
  }

  async function decideReceipt(params: {
    returnRequestId: string
    sellerId: string
    decisions: ReceiptDecision[]
  }) {
    const prior = await prisma.returnRequest.findFirst({
      where: { id: params.returnRequestId, sellerId: params.sellerId },
      include: {
        items: { include: { orderLine: true } },
        escalatedDispute: true,
        messages: {
          include: { attachments: true },
          orderBy: { createdAt: 'asc' },
        },
        evidence: true,
      },
    })
    if (prior && prior.status !== 'in_transit') {
      const decisions = new Map(
        params.decisions.map((decision) => [
          decision.returnRequestItemId,
          decision,
        ]),
      )
      const isSameDecision =
        params.decisions.length === prior.items.length &&
        prior.items.every((item) => {
          const decision = decisions.get(item.id)
          return Boolean(
            decision &&
            decision.acceptedQuantity === item.acceptedQuantity &&
            decision.rejectedQuantity === item.rejectedQuantity,
          )
        })
      if (isSameDecision) {
        let refundTransaction = await prisma.refundTransaction.findUnique({
          where: {
            sourceType_sourceId: {
              sourceType: 'return_request',
              sourceId: prior.id,
            },
          },
        })
        if (
          !refundTransaction &&
          (prior.refundAmount?.gt(0) ||
            prior.items.some((item) => item.grossProductAmount.gt(0)))
        ) {
          const sellerAdjustmentAmount = prior.items.reduce(
            (sum, item) => sum.add(item.sellerAdjustmentAmount),
            new Decimal(0),
          )
          const grossProductAmount = prior.items.reduce(
            (sum, item) => sum.add(item.grossProductAmount),
            new Decimal(0),
          )
          const couponAdjustmentAmount = prior.items.reduce(
            (sum, item) => sum.add(item.couponAdjustmentAmount),
            new Decimal(0),
          )
          const commissionAdjustmentAmount = prior.items.reduce(
            (sum, item) => sum.add(item.commissionAdjustmentAmount),
            new Decimal(0),
          )
          refundTransaction = await refunds.queue({
            orderId: prior.orderId,
            ...(prior.sellerId ? { sellerId: prior.sellerId } : {}),
            sourceType: 'return_request',
            sourceId: prior.id,
            customerAmount: prior.refundAmount ?? new Decimal(0),
            grossProductAmount,
            couponAdjustmentAmount,
            sellerAdjustmentAmount,
            commissionAdjustmentAmount,
            platformFundedAmount: Decimal.max(
              new Decimal(0),
              (prior.refundAmount ?? new Decimal(0))
                .sub(sellerAdjustmentAmount)
                .sub(commissionAdjustmentAmount),
            ),
            items: prior.items
              .filter((item) => item.acceptedQuantity > 0)
              .map((item) => ({
                orderLineId: item.orderLineId,
                quantity: item.acceptedQuantity,
                amount: item.customerRefundAmount,
              })),
            shippingAmount: Decimal.max(
              new Decimal(0),
              (prior.refundAmount ?? new Decimal(0)).sub(
                prior.items.reduce(
                  (sum, item) => sum.add(item.customerRefundAmount),
                  new Decimal(0),
                ),
              ),
            ),
          })
        }
        return { request: prior, refundTransaction }
      }
    }

    const result = await prisma
      .$transaction(
        async (tx) => {
          const request = await tx.returnRequest.findFirst({
            where: { id: params.returnRequestId, sellerId: params.sellerId },
            include: { items: { include: { orderLine: true } }, order: true },
          })
          if (!request)
            throw new NotFoundError('ReturnRequest', params.returnRequestId)
          if (request.status !== 'in_transit') {
            throw new ConflictError(
              `İade bu aşamada teslim kararı kabul etmiyor: ${request.status}`,
            )
          }
          if (params.decisions.length !== request.items.length) {
            throw new ValidationError(
              'Her iade ürünü için kabul/red adedi girilmelidir',
            )
          }

          const claimed = await tx.returnRequest.updateMany({
            where: { id: request.id, status: 'in_transit' },
            data: { status: 'received', sellerReceivedAt: new Date() },
          })
          if (claimed.count !== 1) {
            throw new ConflictError(
              'İade teslim kararı başka bir işlemle güncellendi',
            )
          }

          const decisionById = new Map(
            params.decisions.map((decision) => [
              decision.returnRequestItemId,
              decision,
            ]),
          )
          let acceptedCustomerAmount = new Decimal(0)
          let acceptedGrossProductAmount = new Decimal(0)
          let acceptedCouponAdjustmentAmount = new Decimal(0)
          let acceptedSellerAmount = new Decimal(0)
          let acceptedCommissionAmount = new Decimal(0)
          let acceptedShippingAmount = new Decimal(0)
          const refundItems: Array<{
            orderLineId: string
            quantity: number
            amount: Decimal
          }> = []
          const rejectedDescriptions: string[] = []

          for (const item of request.items) {
            const decision = decisionById.get(item.id)
            if (!decision) throw new ValidationError('Geçersiz iade kalemi')
            if (
              !Number.isInteger(decision.acceptedQuantity) ||
              !Number.isInteger(decision.rejectedQuantity) ||
              decision.acceptedQuantity < 0 ||
              decision.rejectedQuantity < 0 ||
              decision.acceptedQuantity + decision.rejectedQuantity !==
                item.requestedQuantity
            ) {
              throw new ValidationError(
                `"${item.orderLine.productName}" için kabul + red, talep adedine eşit olmalı`,
              )
            }
            if (
              decision.rejectedQuantity > 0 &&
              (decision.rejectionReason?.trim().length ?? 0) < 3
            ) {
              throw new ValidationError(
                'Reddedilen her ürün için en az 3 karakterlik gerekçe gerekli',
              )
            }

            const accepted =
              decision.acceptedQuantity > 0
                ? allocateProductRefund(
                    {
                      quantity: item.requestedQuantity,
                      totalPrice: item.requestedGrossProductAmount,
                      customerPaidProductAmount: item.requestedCustomerAmount,
                      couponDiscountAmount:
                        item.requestedCouponAdjustmentAmount,
                      commissionAmount:
                        item.requestedCommissionAdjustmentAmount,
                      commissionExemptedAt: item.orderLine.commissionExemptedAt,
                    },
                    0,
                    decision.acceptedQuantity,
                  )
                : {
                    customerAmount: new Decimal(0),
                    grossAmount: new Decimal(0),
                    couponAmount: new Decimal(0),
                    sellerAmount: new Decimal(0),
                    commissionAmount: new Decimal(0),
                  }
            const {
              customerAmount: acceptedCustomer,
              grossAmount: acceptedGross,
              couponAmount: acceptedCoupon,
              sellerAmount: acceptedSeller,
              commissionAmount: acceptedCommission,
            } = accepted

            await tx.returnRequestItem.update({
              where: { id: item.id },
              data: {
                acceptedQuantity: decision.acceptedQuantity,
                rejectedQuantity: decision.rejectedQuantity,
                rejectionReason: decision.rejectionReason?.trim() || null,
                customerRefundAmount: acceptedCustomer,
                grossProductAmount: acceptedGross,
                couponAdjustmentAmount: acceptedCoupon,
                sellerAdjustmentAmount: acceptedSeller,
                commissionAdjustmentAmount: acceptedCommission,
              },
            })
            acceptedCustomerAmount =
              acceptedCustomerAmount.add(acceptedCustomer)
            acceptedGrossProductAmount =
              acceptedGrossProductAmount.add(acceptedGross)
            acceptedCouponAdjustmentAmount =
              acceptedCouponAdjustmentAmount.add(acceptedCoupon)
            acceptedSellerAmount = acceptedSellerAmount.add(acceptedSeller)
            acceptedCommissionAmount =
              acceptedCommissionAmount.add(acceptedCommission)
            if (decision.acceptedQuantity > 0) {
              refundItems.push({
                orderLineId: item.orderLineId,
                quantity: decision.acceptedQuantity,
                amount: acceptedCustomer,
              })
            }
            if (decision.rejectedQuantity > 0) {
              rejectedDescriptions.push(
                `${item.orderLine.productName}: ${decision.rejectedQuantity} adet — ${decision.rejectionReason!.trim()}`,
              )
            }
          }

          const lineTotals = await tx.orderLine.aggregate({
            where: { orderId: request.orderId },
            _sum: { quantity: true, cancelledQuantity: true },
          })
          const acceptedTotals = await tx.returnRequestItem.aggregate({
            where: { orderLine: { orderId: request.orderId } },
            _sum: { acceptedQuantity: true },
          })
          const disputeResolvedTotals = await tx.returnRequestItem.aggregate({
            where: {
              orderLine: { orderId: request.orderId },
              returnRequest: {
                escalatedDispute: {
                  is: { status: 'resolved_for_customer' },
                },
              },
            },
            _sum: { rejectedQuantity: true },
          })
          const totalQuantity = lineTotals._sum.quantity ?? 0
          if (
            isQuantityFullyClosed({
              originalQuantity: totalQuantity,
              cancelledQuantity: lineTotals._sum.cancelledQuantity ?? 0,
              acceptedReturnQuantity:
                (acceptedTotals._sum.acceptedQuantity ?? 0) +
                (disputeResolvedTotals._sum.rejectedQuantity ?? 0),
            })
          ) {
            const shippingRefund = request.order.shippingAmount.sub(
              request.order.refundedShippingAmount,
            )
            if (shippingRefund.gt(0)) {
              acceptedShippingAmount = shippingRefund
              acceptedCustomerAmount =
                acceptedCustomerAmount.add(shippingRefund)
              await tx.order.update({
                where: { id: request.orderId },
                data: { refundedShippingAmount: { increment: shippingRefund } },
              })
            }
          }

          let disputeId: string | undefined
          if (rejectedDescriptions.length > 0) {
            const seller = await tx.seller.findUnique({
              where: { id: params.sellerId },
              select: { userId: true },
            })
            if (!seller) throw new ForbiddenError('Satıcı bulunamadı')
            const dispute = await tx.dispute.create({
              data: {
                orderId: request.orderId,
                openedById: seller.userId,
                reason: 'Adet bazlı iade teslim reddi',
                description: rejectedDescriptions.join('\n'),
              },
            })
            disputeId = dispute.id
          }

          await tx.returnRequest.update({
            where: { id: request.id },
            data: {
              status:
                acceptedGrossProductAmount.gt(0) || acceptedCustomerAmount.gt(0)
                  ? 'received'
                  : 'rejected',
              refundAmount: acceptedCustomerAmount,
              sellerReceivedAt: new Date(),
              ...(rejectedDescriptions.length > 0
                ? {
                    sellerRejectReason: 'Bazı iade kalemleri reddedildi',
                    sellerRejectDescription: rejectedDescriptions.join('\n'),
                    sellerRejectedAt: new Date(),
                    ...(disputeId ? { disputeId } : {}),
                  }
                : {}),
            },
          })

          await recordReturnDecisionNotification(tx, request, params.decisions, {
            refundAmount: acceptedCustomerAmount,
            disputeOpened: Boolean(disputeId),
          })

          return {
            request,
            acceptedCustomerAmount,
            acceptedGrossProductAmount,
            acceptedCouponAdjustmentAmount,
            acceptedSellerAmount,
            acceptedCommissionAmount,
            acceptedShippingAmount,
            refundItems,
            rejectedDescriptions,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error) => {
        if (isRetryable(error)) {
          throw new ConflictError(
            'İade kararı eşzamanlı bir işlemle değişti; güncel durumu yenileyin',
          )
        }
        throw error
      })

    let refundTransaction = null
    if (
      result.acceptedCustomerAmount.gt(0) ||
      result.acceptedGrossProductAmount.gt(0)
    ) {
      refundTransaction = await refunds.queue({
        orderId: result.request.orderId,
        sellerId: params.sellerId,
        sourceType: 'return_request',
        sourceId: result.request.id,
        customerAmount: result.acceptedCustomerAmount,
        grossProductAmount: result.acceptedGrossProductAmount,
        couponAdjustmentAmount: result.acceptedCouponAdjustmentAmount,
        sellerAdjustmentAmount: result.acceptedSellerAmount,
        commissionAdjustmentAmount: result.acceptedCommissionAmount,
        platformFundedAmount: Decimal.max(
          new Decimal(0),
          result.acceptedCustomerAmount
            .sub(result.acceptedSellerAmount)
            .sub(result.acceptedCommissionAmount),
        ),
        items: result.refundItems,
        shippingAmount: result.acceptedShippingAmount,
      })
      if (refundTransaction.status === 'completed') {
        await prisma.returnRequest.update({
          where: { id: result.request.id },
          data: {
            status: 'refund_completed',
            refundAmount: result.acceptedCustomerAmount,
            refundedAt: new Date(),
          },
        })
      }
    }

    return prisma.returnRequest
      .findUnique({
        where: { id: params.returnRequestId },
        include: {
          items: { include: { orderLine: true } },
          escalatedDispute: true,
          messages: {
            include: { attachments: true },
            orderBy: { createdAt: 'asc' },
          },
          evidence: true,
        },
      })
      .then((request) => ({ request, refundTransaction }))
  }

  // The record* helpers are exposed for unit tests of the e-mail payloads.
  return {
    openRequest,
    decideReceipt,
    recordReturnOpenedNotifications,
    recordReturnDecisionNotification,
  }
}

export type QuantityReturnService = ReturnType<
  typeof createQuantityReturnService
>
