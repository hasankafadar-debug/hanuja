import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../lib/errors'
import {
  allocateQuantitySlice,
  isQuantityFullyClosed,
} from '../domain/quantity-allocation'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { createQuantityRefundService } from './quantity-refund.service'
import { enqueueNotification } from '../jobs/notification-dispatch.job'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl } from '../lib/platform-info'
import { formatMoney } from '@hanuja/security/money'

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

    void notifyReturnOpened(operations).catch((error) =>
      console.error('[quantity-return] Notification failed:', error),
    )
    return operations
  }

  async function notifyReturnOpened(
    operations: Array<{
      id: string
      orderId: string
      sellerId: string | null
      customerId: string
      reason: string
      items: Array<{
        requestedQuantity: number
        orderLine: {
          productName: string
          variantName: string | null
          unitPrice: Decimal
        }
      }>
    }>,
  ) {
    const sellerIds = operations
      .map((operation) => operation.sellerId)
      .filter((sellerId): sellerId is string => Boolean(sellerId))
    const [sellers, admins] = await Promise.all([
      prisma.seller.findMany({
        where: { id: { in: sellerIds } },
        select: {
          id: true,
          displayName: true,
          user: { select: { id: true, email: true } },
        },
      }),
      prisma.user.findMany({ where: { role: 'admin' }, select: { id: true } }),
    ])
    const sellerById = new Map(sellers.map((seller) => [seller.id, seller]))
    for (const operation of operations) {
      const order = await prisma.order.findUnique({
        where: { id: operation.orderId },
        select: { id: true, publicNumber: true },
      })
      if (!order) continue
      const orderNumber = formatOrderNumber(order.publicNumber, order.id)
      const items = operation.items.map((item) => ({
        productName: item.orderLine.productName,
        variantName: item.orderLine.variantName,
        sellerId: operation.sellerId ?? undefined,
        quantity: item.requestedQuantity,
        unitPrice: formatMoney(item.orderLine.unitPrice.toNumber()),
        lineTotal: formatMoney(
          item.orderLine.unitPrice.mul(item.requestedQuantity).toNumber(),
        ),
      }))
      const summary = items
        .map((item) => `${item.productName} (${item.quantity})`)
        .join(', ')
      const data = {
        operationId: operation.id,
        orderId: order.id,
        orderNumber,
        sellerId: operation.sellerId,
        returnReason: operation.reason,
        items,
      }
      await enqueueNotification({
        eventKey: `return:${operation.id}:customer:requested`,
        userId: operation.customerId,
        type: 'return_requested',
        title: 'İade talebiniz alındı',
        body: summary,
        data,
      })
      if (operation.sellerId) {
        const seller = sellerById.get(operation.sellerId)
        if (seller) {
          await enqueueNotification({
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
        await enqueueNotification({
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
      include: { lines: true },
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
        const customerAmount = allocateQuantitySlice({
          totalAmount: line.customerPaidProductAmount ?? line.totalPrice,
          originalQuantity: line.quantity,
          consumedQuantity: consumed,
          requestedQuantity: quantity,
        })
        const grossAmount = allocateQuantitySlice({
          totalAmount: line.totalPrice,
          originalQuantity: line.quantity,
          consumedQuantity: consumed,
          requestedQuantity: quantity,
        })
        const couponAmount = allocateQuantitySlice({
          totalAmount: line.couponDiscountAmount,
          originalQuantity: line.quantity,
          consumedQuantity: consumed,
          requestedQuantity: quantity,
        })
        const sellerAmount = allocateQuantitySlice({
          totalAmount: line.netPayoutAmount,
          originalQuantity: line.quantity,
          consumedQuantity: consumed,
          requestedQuantity: quantity,
        })
        const commissionAmount = allocateQuantitySlice({
          totalAmount: line.commissionAmount,
          originalQuantity: line.quantity,
          consumedQuantity: consumed,
          requestedQuantity: quantity,
        })
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
        if (!refundTransaction && prior.refundAmount?.gt(0)) {
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
            customerAmount: prior.refundAmount,
            grossProductAmount,
            couponAdjustmentAmount,
            sellerAdjustmentAmount,
            commissionAdjustmentAmount,
            platformFundedAmount: Decimal.max(
              new Decimal(0),
              prior.refundAmount
                .sub(sellerAdjustmentAmount)
                .sub(commissionAdjustmentAmount),
            ),
            items: prior.items
              .filter((item) => item.customerRefundAmount.gt(0))
              .map((item) => ({
                orderLineId: item.orderLineId,
                quantity: item.acceptedQuantity,
                amount: item.customerRefundAmount,
              })),
            shippingAmount: Decimal.max(
              new Decimal(0),
              prior.refundAmount.sub(
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

            const acceptedCustomer =
              decision.acceptedQuantity > 0
                ? allocateQuantitySlice({
                    totalAmount: item.requestedCustomerAmount,
                    originalQuantity: item.requestedQuantity,
                    consumedQuantity: 0,
                    requestedQuantity: decision.acceptedQuantity,
                  })
                : new Decimal(0)
            const acceptedSeller =
              decision.acceptedQuantity > 0
                ? allocateQuantitySlice({
                    totalAmount: item.requestedSellerAdjustmentAmount,
                    originalQuantity: item.requestedQuantity,
                    consumedQuantity: 0,
                    requestedQuantity: decision.acceptedQuantity,
                  })
                : new Decimal(0)
            const acceptedGross =
              decision.acceptedQuantity > 0
                ? allocateQuantitySlice({
                    totalAmount: item.requestedGrossProductAmount,
                    originalQuantity: item.requestedQuantity,
                    consumedQuantity: 0,
                    requestedQuantity: decision.acceptedQuantity,
                  })
                : new Decimal(0)
            const acceptedCoupon =
              decision.acceptedQuantity > 0
                ? allocateQuantitySlice({
                    totalAmount: item.requestedCouponAdjustmentAmount,
                    originalQuantity: item.requestedQuantity,
                    consumedQuantity: 0,
                    requestedQuantity: decision.acceptedQuantity,
                  })
                : new Decimal(0)
            const acceptedCommission =
              decision.acceptedQuantity > 0
                ? allocateQuantitySlice({
                    totalAmount: item.requestedCommissionAdjustmentAmount,
                    originalQuantity: item.requestedQuantity,
                    consumedQuantity: 0,
                    requestedQuantity: decision.acceptedQuantity,
                  })
                : new Decimal(0)

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
            if (acceptedCustomer.gt(0)) {
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
          const disputeResolvedTotals =
            await tx.returnRequestItem.aggregate({
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
              status: acceptedCustomerAmount.gt(0) ? 'received' : 'rejected',
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
    if (result.acceptedCustomerAmount.gt(0)) {
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

    void enqueueNotification({
      userId: result.request.customerId,
      type:
        result.rejectedDescriptions.length > 0
          ? 'order_return_rejected'
          : 'return_status_changed',
      title:
        result.rejectedDescriptions.length > 0
          ? 'İade kararınız güncellendi'
          : 'İadeniz kabul edildi',
      body:
        result.rejectedDescriptions.length > 0
          ? result.rejectedDescriptions.join(', ')
          : `${result.acceptedCustomerAmount.toFixed(2)} TRY iade kuyruğuna alındı`,
      data: { operationId: result.request.id, sellerId: params.sellerId },
    }).catch((error) =>
      console.error('[quantity-return] Decision notification failed:', error),
    )

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

  return { openRequest, decideReceipt }
}

export type QuantityReturnService = ReturnType<
  typeof createQuantityReturnService
>
