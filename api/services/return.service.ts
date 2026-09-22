/**
 * Return Service — seller-driven return lifecycle (08-order-lifecycle-rules.md).
 *
 * Flow:
 *   customer openRequest (within 14 calendar days — HARD cutoff)
 *     → seller provideSellerCargoInfo (status approved)
 *     → customer submitCustomerShipment (status in_transit)
 *     → seller confirmReceiptBySeller → AUTO refund → refund_completed
 *        OR seller rejectReceiptBySeller → auto-open Dispute (escalate to admin)
 *
 * Open return BLOCKS payout — no exceptions without explicit resolution.
 * Refund money movement is finance-sensitive: idempotent, ledger-tracked.
 */
import { Prisma, type PrismaClient, type ReturnRequestStatus, type UserRole } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../lib/errors'
import { createReturnRequestRepository } from '../repositories/return-request.repository'
import { createOrderRepository } from '../repositories/order.repository'
import { createDisputeRepository } from '../repositories/dispute.repository'
import { createAdminAuditLogRepository } from '../repositories/admin-audit-log.repository'
import { recordNotification } from './notification-outbox.service'
import { createRefundService } from './refund.service'
import { dispatchRefundProcessingAfterCommit } from './quantity-refund.service'
import { sellerScopedReturnWhere } from '../repositories/return-request.repository'
import { isWithinReturnWindow } from '../domain/penalty-calculator'
import { assertTransition } from '../domain/order-state-machine'
import { assertNoContactSharing } from './contact-sharing-guard.service'
import { formatMoney, roundMoney } from '@hanuja/security/money'
import { formatOrderNumber } from '../lib/order-number'
import { getSellerPanelUrl, getWebBaseUrl } from '../lib/platform-info'
import { resolveEmailImageUrl } from '../lib/email-line-items'
import type { RefundOutcome, ReturnDecision } from '../lib/email-templates/types'

/** Prisma marks a serialization failure with P2034; those are safe to retry. */
function isSerializationFailure(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2034'
  )
}

interface ReturnServiceDeps {
  prisma: PrismaClient
}

export function createReturnService({ prisma }: ReturnServiceDeps) {
  const returnRequests = createReturnRequestRepository(prisma)
  const orders = createOrderRepository(prisma)
  const disputes = createDisputeRepository(prisma)
  const refunds = createRefundService({ prisma })

  /**
   * Every mutation below runs in one transaction: business state, status
   * history, audit entry, the persisted refund record and the notification
   * outbox row commit together. Helpers therefore take the transaction client;
   * a crash between the business write and the e-mail is no longer possible.
   */
  type ReturnTx = Prisma.TransactionClient
  const TX_OPTIONS = { timeout: 30_000 } as const

  /** Resolve a seller's auth userId for notifications. */
  async function sellerUserId(tx: ReturnTx, sellerId: string): Promise<string | null> {
    const seller = await tx.seller.findUnique({
      where: { id: sellerId },
      select: { userId: true },
    })
    return seller?.userId ?? null
  }

  /** Attach uploaded media to a return request / message — ownership enforced. */
  async function linkAssets(
    tx: ReturnTx,
    assetIds: string[],
    ownerUserId: string,
    patch: { returnRequestId?: string; returnMessageId?: string },
  ) {
    if (assetIds.length === 0) return
    await tx.mediaAsset.updateMany({
      where: { id: { in: assetIds }, uploadedBy: ownerUserId },
      data: { ...patch, type: 'return_evidence' },
    })
  }

  /**
   * What the customer is told about the money — derived from the persisted
   * RefundTransaction, never from the caller's intent. `null` means no refund
   * record exists yet (the item has not been received back).
   */
  function refundOutcomeOf(
    refund: { status: string; customerAmount: Decimal } | null,
  ): RefundOutcome {
    if (!refund) return 'awaiting_return'
    switch (refund.status) {
      case 'pending':
      case 'processing':
        return 'processing'
      case 'manual_required':
        return 'manual_review'
      case 'completed':
        return refund.customerAmount.lte(0) ? 'no_refund_due' : 'completed'
      case 'partially_completed':
      case 'failed':
      default:
        // Unmapped states are never presented as a started payment.
        return 'under_review'
    }
  }

  /**
   * Re-read the return request inside the transaction with the same seller
   * authorisation the repository uses (legacy rows without sellerId are scoped
   * through the seller's order lines) and claim the expected status atomically,
   * so two concurrent requests cannot both write history or open a dispute.
   */
  async function claimForSeller(
    tx: ReturnTx,
    params: { returnRequestId: string; sellerId: string; from: ReturnRequestStatus[] },
  ) {
    const current = await tx.returnRequest.findFirst({
      where: sellerScopedReturnWhere(params.returnRequestId, params.sellerId),
      include: {
        items: { include: { orderLine: true } },
        order: { include: { lines: true, payments: true } },
      },
    })
    if (!current) throw new NotFoundError('ReturnRequest', params.returnRequestId)
    if (!params.from.includes(current.status)) {
      throw new ConflictError(`İade bu aşamada bu işlemi kabul etmiyor: ${current.status}`)
    }
    return current
  }

  /** Atomic status transition; the loser of a concurrent call gets a conflict. */
  async function claimStatus(
    tx: ReturnTx,
    id: string,
    from: ReturnRequestStatus,
    write: () => Promise<unknown>,
  ) {
    const claimed = await tx.returnRequest.updateMany({
      where: { id, status: from },
      data: { status: from },
    })
    if (claimed.count !== 1) {
      throw new ConflictError('İade talebi başka bir işlemle güncellendi; sayfayı yenileyin')
    }
    await write()
  }

  type ReturnEmailRequest = {
    id: string
    orderId: string
    customerId: string
    reason: string
    sellerId?: string | null
    items: Array<{
      id: string
      requestedQuantity: number
      orderLine: { productId: string; productName: string; variantName: string | null; unitPrice: Decimal }
    }>
    order: {
      id: string
      publicNumber: number
      lines: Array<{
        id: string
        sellerId: string
        productId: string
        productName: string
        variantName: string | null
        unitPrice: Decimal
        quantity: number
        cancelledQuantity: number
      }>
    }
  }

  /**
   * Common e-mail payload for return notifications: customer identity, order
   * number, and the returned lines (quantity-based items when present, otherwise
   * the active lines of the seller on legacy requests).
   */
  async function buildReturnEmailContext(
    tx: ReturnTx,
    rr: ReturnEmailRequest,
    sellerId?: string,
  ) {
    const customer = await tx.user.findUnique({
      where: { id: rr.customerId },
      select: { email: true, name: true },
    })
    const sourceLines =
      rr.items.length > 0
        ? rr.items.map((item) => ({
            productId: item.orderLine.productId,
            productName: item.orderLine.productName,
            variantName: item.orderLine.variantName,
            unitPrice: item.orderLine.unitPrice,
            quantity: item.requestedQuantity,
            itemId: item.id,
          }))
        : rr.order.lines
            .filter((line) => !sellerId || line.sellerId === sellerId)
            .map((line) => ({
              productId: line.productId,
              productName: line.productName,
              variantName: line.variantName,
              unitPrice: line.unitPrice,
              quantity: Math.max(0, line.quantity - line.cancelledQuantity),
              itemId: line.id,
            }))
            .filter((line) => line.quantity > 0)
    const images = await tx.productImage.findMany({
      where: { productId: { in: [...new Set(sourceLines.map((line) => line.productId))] } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      select: { productId: true, url: true, isPrimary: true, sortOrder: true },
    })
    const imagesByProduct = new Map<string, typeof images>()
    for (const image of images) {
      const bucket = imagesByProduct.get(image.productId) ?? []
      bucket.push(image)
      imagesByProduct.set(image.productId, bucket)
    }
    const items = sourceLines.map((line) => ({
      itemId: line.itemId,
      productName: line.productName,
      variantName: line.variantName,
      quantity: line.quantity,
      unitPrice: formatMoney(new Decimal(line.unitPrice).toNumber()),
      lineTotal: formatMoney(new Decimal(line.unitPrice).mul(line.quantity).toNumber()),
      imageUrl: resolveEmailImageUrl(imagesByProduct.get(line.productId)),
    }))
    return {
      customerEmail: customer?.email ?? undefined,
      customerName: customer?.name?.trim() || 'Değerli Müşterimiz',
      orderNumber: formatOrderNumber(rr.order.publicNumber, rr.order.id),
      orderUrl: `${getWebBaseUrl()}/siparis/${rr.order.id}`,
      items,
    }
  }

  /**
   * Customer decision e-mail for the legacy (non quantity) flow and admin
   * overrides. The caller supplies a stage-specific event key so the first
   * approval cannot swallow the later refund decision, and the money wording
   * comes from `refundOutcome`, which is derived from the persisted record.
   */
  async function notifyCustomerReturnDecision(
    tx: ReturnTx,
    rr: ReturnEmailRequest,
    decision: ReturnDecision,
    options: {
      eventKey: string
      refundOutcome: RefundOutcome
      sellerId?: string
      refundAmount?: Decimal
      disputeOpened?: boolean
      reviewNote?: string
      rejectionReason?: string
    },
  ) {
    const context = await buildReturnEmailContext(tx, rr, options.sellerId)
    await recordNotification(tx, {
      eventKey: options.eventKey,
      userId: rr.customerId,
      ...(context.customerEmail ? { emailTo: context.customerEmail } : {}),
      type: decision === 'rejected' ? 'order_return_rejected' : 'order_return_approved',
      title:
        decision === 'approved'
          ? 'İadeniz kabul edildi'
          : decision === 'partial'
            ? 'İadeniz kısmen kabul edildi'
            : options.disputeOpened
              ? 'İadeniz reddedildi — uyuşmazlık açıldı'
              : 'İadeniz reddedildi',
      body:
        decision === 'rejected'
          ? (options.rejectionReason ?? options.reviewNote ?? 'İade talebiniz reddedildi.')
          : options.refundAmount && options.refundOutcome !== 'awaiting_return'
            ? `Onaylanan iade tutarı: ${formatMoney(options.refundAmount.toNumber())}.`
            : 'İade talebiniz kabul edildi.',
      data: {
        returnRequestId: rr.id,
        orderId: rr.orderId,
        orderNumber: context.orderNumber,
        customerName: context.customerName,
        decision,
        refundOutcome: options.refundOutcome,
        disputeOpened: options.disputeOpened ?? false,
        ...(options.refundAmount ? { refundAmount: formatMoney(options.refundAmount.toNumber()) } : {}),
        ...(options.reviewNote ? { reviewNote: options.reviewNote } : {}),
        orderUrl: context.orderUrl,
        items: context.items.map((item) => ({
          ...item,
          acceptedQuantity: decision === 'rejected' ? 0 : item.quantity,
          rejectedQuantity: decision === 'rejected' ? item.quantity : 0,
          rejectionReason: decision === 'rejected' ? (options.rejectionReason ?? null) : null,
        })),
      },
    })
  }

  /** The seller that owns lines on this order (single-seller assumption). */
  function resolveOrderSellerId(
    lines: { sellerId: string }[],
    requireSellerId?: string,
  ): string {
    const sellerIds = [...new Set(lines.map((l) => l.sellerId))]
    if (requireSellerId) {
      if (!sellerIds.includes(requireSellerId)) {
        throw new ForbiddenError('Bu iade talebi sizin siparişinize ait değil')
      }
      return requireSellerId
    }
    if (sellerIds.length !== 1) {
      throw new ConflictError('Çok satıcılı sipariş iadesi henüz desteklenmiyor')
    }
    return sellerIds[0]!
  }

  return {
    /**
     * Customer opens a return request — only within the 14 calendar-day window.
     * After the window the path is fully closed (locked policy decision).
     */
    async openRequest(params: {
      orderId: string
      customerId: string
      reason: string
      description?: string
      evidenceAssetIds?: string[]
    }) {
      const order = await orders.findByIdForCustomer(params.orderId, params.customerId)
      if (!order) throw new NotFoundError('Order', params.orderId)

      if (order.quantityLifecycleVersion === 2) {
        throw new ConflictError('Bu siparişte ürün ve adet seçerek iade talebi oluşturun')
      }

      if (!order.deliveryConfirmedAt) {
        throw new ConflictError('Teslim onaylanmadan iade talebi açılamaz')
      }

      const isWithinWindow = isWithinReturnWindow(order.deliveryConfirmedAt)
      if (!isWithinWindow) {
        throw new ConflictError(
          'İade süresi doldu — teslim onayından sonraki 14 günlük iade hakkı sona erdi',
        )
      }

      // Serializable + bounded retry: the "one open return per order" rule has no
      // unique index, so two concurrent requests must be serialised rather than
      // both passing the count check.
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await prisma.$transaction(
            async (tx) => {
              const openCount = await tx.returnRequest.count({
                where: {
                  orderId: params.orderId,
                  status: { notIn: ['rejected', 'refund_completed'] },
                },
              })
              if (openCount > 0) {
                throw new ConflictError('Bu sipariş için zaten açık bir iade talebi var')
              }

              const returnRequest = await returnRequests.create(
                {
                  orderId: params.orderId,
                  customerId: params.customerId,
                  reason: params.reason,
                  ...(params.description !== undefined && { description: params.description }),
                  isWithinWindow,
                },
                tx,
              )

              if (params.evidenceAssetIds?.length) {
                await linkAssets(tx, params.evidenceAssetIds, params.customerId, {
                  returnRequestId: returnRequest.id,
                })
              }

              assertTransition(order.status, 'return_requested')
              await orders.updateStatus(params.orderId, 'return_requested', tx as PrismaClient)
              await orders.appendStatusHistory(
                params.orderId,
                'return_requested',
                params.customerId,
                `İade talebi: ${params.reason}`,
                tx as PrismaClient,
              )

              const emailRequest: ReturnEmailRequest = {
                id: returnRequest.id,
                orderId: params.orderId,
                customerId: params.customerId,
                reason: params.reason,
                items: [],
                order,
              }
              const customerContext = await buildReturnEmailContext(tx, emailRequest)
              await recordNotification(tx, {
                eventKey: `return:${returnRequest.id}:customer:requested`,
                userId: params.customerId,
                ...(customerContext.customerEmail ? { emailTo: customerContext.customerEmail } : {}),
                type: 'return_requested',
                title: 'İade talebiniz alındı',
                body: `#${customerContext.orderNumber} siparişi için iade talebiniz alındı.`,
                data: {
                  returnRequestId: returnRequest.id,
                  orderId: params.orderId,
                  orderNumber: customerContext.orderNumber,
                  customerName: customerContext.customerName,
                  returnReason: params.reason,
                  orderUrl: customerContext.orderUrl,
                  items: customerContext.items,
                },
              })

              // Notify seller(s) that own lines on this order
              const sellerIds = [...new Set(order.lines.map((l) => l.sellerId))]
              for (const sid of sellerIds) {
                const seller = await tx.seller.findUnique({
                  where: { id: sid },
                  select: { userId: true, displayName: true, user: { select: { email: true } } },
                })
                if (seller) {
                  const sellerContext = await buildReturnEmailContext(tx, emailRequest, sid)
                  await recordNotification(tx, {
                    eventKey: `return:${returnRequest.id}:seller:requested:${sid}`,
                    userId: seller.userId,
                    emailTo: seller.user.email,
                    type: 'seller_return_request',
                    title: 'Yeni İade Talebi',
                    body: `#${order.publicNumber} siparişi için iade talebi açıldı. İade kargo bilgisini girmeniz bekleniyor.`,
                    data: {
                      orderId: params.orderId,
                      returnRequestId: returnRequest.id,
                      orderNumber: sellerContext.orderNumber,
                      sellerId: sid,
                      sellerName: seller.displayName,
                      returnReason: params.reason,
                      panelUrl: `${getSellerPanelUrl()}/iadeler/${returnRequest.id}`,
                      items: sellerContext.items.map((item) => ({ ...item, sellerId: sid })),
                    },
                  })
                }
              }

              return returnRequest
            },
            { ...TX_OPTIONS, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
          )
        } catch (error) {
          if (attempt < 3 && isSerializationFailure(error)) continue
          throw error
        }
      }
    },

    /**
     * Seller provides the return cargo instructions to the customer.
     * Within the legal window the return is a customer right — the seller
     * cannot reject the request here, only provide cargo info.
     */
    async provideSellerCargoInfo(params: {
      returnRequestId: string
      sellerId: string
      address: string
      carrier: string
      instructions?: string
    }) {
      return prisma.$transaction(async (tx) => {
        const rr = await claimForSeller(tx, {
          returnRequestId: params.returnRequestId,
          sellerId: params.sellerId,
          from: ['requested', 'under_review'],
        })

        let updated = rr
        await claimStatus(tx, rr.id, rr.status, async () => {
          updated = (await returnRequests.setSellerCargoInfo(
            params.returnRequestId,
            {
              address: params.address,
              carrier: params.carrier,
              ...(params.instructions !== undefined && { instructions: params.instructions }),
            },
            tx,
          )) as typeof rr
        })

        assertTransition(rr.order.status, 'return_approved')
        await orders.updateStatus(rr.orderId, 'return_approved', tx as PrismaClient)
        await orders.appendStatusHistory(
          rr.orderId,
          'return_approved',
          `seller_${params.sellerId}`,
          'Satıcı iade kargo bilgilerini iletti',
          tx as PrismaClient,
        )

        const context = await buildReturnEmailContext(tx, rr, params.sellerId)
        await recordNotification(tx, {
          eventKey: `return:${rr.id}:customer:cargo-info`,
          userId: rr.customerId,
          ...(context.customerEmail ? { emailTo: context.customerEmail } : {}),
          type: 'return_status_changed',
          title: 'İade Kargo Bilgileri Hazır',
          body: 'Satıcı iade kargo bilgilerini iletti. Ürünü kargoya verip kargo bilgilerini girebilirsiniz.',
          data: {
            stage: 'cargo_info_ready',
            orderId: rr.orderId,
            returnRequestId: rr.id,
            orderNumber: context.orderNumber,
            customerName: context.customerName,
            cargoAddress: params.address,
            cargoCarrier: params.carrier,
            ...(params.instructions ? { cargoInstructions: params.instructions } : {}),
            orderUrl: context.orderUrl,
            items: context.items,
          },
        })

        return updated
      }, TX_OPTIONS)
    },

    /**
     * Customer ships the item back and provides tracking and/or a cargo
     * barcode photo. Either a tracking number or a barcode asset is required.
     */
    async submitCustomerShipment(params: {
      returnRequestId: string
      customerId: string
      carrier: string
      trackingNumber?: string
      barcodeAssetId?: string
    }) {
      if (!params.trackingNumber && !params.barcodeAssetId) {
        throw new ValidationError(
          'Kargo takip numarası veya kargo barkod görseli gerekli',
        )
      }

      return prisma.$transaction(async (tx) => {
        const rr = await tx.returnRequest.findUnique({
          where: { id: params.returnRequestId },
          include: {
            items: { include: { orderLine: true } },
            order: { include: { lines: true, payments: true } },
          },
        })
        if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
        if (rr.customerId !== params.customerId) {
          throw new ForbiddenError('Bu iade talebi size ait değil')
        }
        if (rr.status !== 'approved') {
          throw new ConflictError(`İade bu aşamada kargo bilgisi kabul etmiyor: ${rr.status}`)
        }

        let updated = rr
        await claimStatus(tx, rr.id, 'approved', async () => {
          updated = (await returnRequests.setCustomerShipment(
            params.returnRequestId,
            {
              carrier: params.carrier,
              ...(params.trackingNumber !== undefined && {
                trackingNumber: params.trackingNumber,
              }),
            },
            tx,
          )) as typeof rr
        })

        if (params.barcodeAssetId) {
          await linkAssets(tx, [params.barcodeAssetId], params.customerId, {
            returnRequestId: rr.id,
          })
        }

        assertTransition(rr.order.status, 'return_in_transit')
        await orders.updateStatus(rr.orderId, 'return_in_transit', tx as PrismaClient)
        await orders.appendStatusHistory(
          rr.orderId,
          'return_in_transit',
          params.customerId,
          `Müşteri ürünü kargoya verdi (${params.carrier})`,
          tx as PrismaClient,
        )

        const sid = resolveOrderSellerId(rr.order.lines)
        const uid = await sellerUserId(tx, sid)
        if (uid) {
          await recordNotification(tx, {
            eventKey: `return:${rr.id}:seller:in-transit`,
            userId: uid,
            type: 'return_status_changed',
            title: 'İade Kargoya Verildi',
            body: 'Müşteri iade ürününü kargoya verdi. Ürün size ulaştığında onaylayın veya reddedin.',
            data: { stage: 'customer_shipped', orderId: rr.orderId, returnRequestId: rr.id },
          })
        }

        return updated
      }, TX_OPTIONS)
    },

    /**
     * Seller confirms physical receipt → triggers the customer refund
     * automatically (locked policy decision). Finance-sensitive + idempotent.
     */
    async confirmReceiptBySeller(params: {
      returnRequestId: string
      sellerId: string
    }) {
      const { refund } = await prisma.$transaction(async (tx) => {
        const rr = await claimForSeller(tx, {
          returnRequestId: params.returnRequestId,
          sellerId: params.sellerId,
          from: ['in_transit'],
        })
        if (rr.items.length > 0) {
          throw new ConflictError('Bu iade için ürün/adet bazlı teslim kararı kullanılmalıdır')
        }

        const sellerId = resolveOrderSellerId(rr.order.lines, params.sellerId)
        const refundAmount = roundMoney(
          rr.order.lines
            .filter((l) => l.sellerId === sellerId)
            .reduce((sum, l) => sum.plus(new Decimal(l.totalPrice)), new Decimal(0)),
        )

        await claimStatus(tx, rr.id, 'in_transit', () =>
          returnRequests.setSellerReceived(params.returnRequestId, tx),
        )

        assertTransition(rr.order.status, 'return_received')
        await orders.updateStatus(rr.orderId, 'return_received', tx as PrismaClient)
        await orders.appendStatusHistory(
          rr.orderId,
          'return_received',
          `seller_${params.sellerId}`,
          'Satıcı iade ürününü teslim aldı ve onayladı',
          tx as PrismaClient,
        )
        assertTransition('return_received', 'refund_pending')
        await orders.updateStatus(rr.orderId, 'refund_pending', tx as PrismaClient)

        // The durable refund record is written here, not after commit: the
        // customer e-mail below describes this record's real state.
        const refund = await refunds.executeReturnRefundInTransaction(tx, {
          returnRequestId: rr.id,
          orderId: rr.orderId,
          sellerId,
          refundAmount,
        })

        await notifyCustomerReturnDecision(tx, rr, 'approved', {
          eventKey: `return:${rr.id}:customer:receipt-approved`,
          refundOutcome: refundOutcomeOf(refund),
          sellerId,
          refundAmount,
        })

        return { refund }
      }, TX_OPTIONS)

      // Provider work only — the record above survives a missed dispatch.
      if (refund) await dispatchRefundProcessingAfterCommit(refund)

      return returnRequests.findById(params.returnRequestId)
    },

    /**
     * Seller rejects the received item (wrong/damaged) → auto-open an admin
     * Dispute and keep the conversation continuous. The customer can keep
     * replying with text + images on the same return thread.
     */
    async rejectReceiptBySeller(params: {
      returnRequestId: string
      sellerId: string
      reason: string
      description?: string
      evidenceAssetIds?: string[]
    }) {
      await prisma.$transaction(async (tx) => {
        const rr = await claimForSeller(tx, {
          returnRequestId: params.returnRequestId,
          sellerId: params.sellerId,
          from: ['in_transit'],
        })
        if (rr.items.length > 0) {
          throw new ConflictError('Bu iade için ürün/adet bazlı teslim kararı kullanılmalıdır')
        }

        // Only the winner of this claim writes history and opens the dispute.
        await claimStatus(tx, rr.id, 'in_transit', () =>
          returnRequests.setSellerRejected(
            params.returnRequestId,
            {
              reason: params.reason,
              ...(params.description !== undefined && { description: params.description }),
            },
            tx,
          ),
        )

        const sellerUid = await sellerUserId(tx, params.sellerId)
        if (params.evidenceAssetIds?.length && sellerUid) {
          await linkAssets(tx, params.evidenceAssetIds, sellerUid, {
            returnRequestId: rr.id,
          })
        }

        assertTransition(rr.order.status, 'return_rejected')
        await orders.updateStatus(rr.orderId, 'return_rejected', tx as PrismaClient)
        await orders.appendStatusHistory(
          rr.orderId,
          'return_rejected',
          `seller_${params.sellerId}`,
          `Satıcı iadeyi reddetti: ${params.reason}`,
          tx as PrismaClient,
        )

        // Auto-escalate to an admin dispute (payoutBlocked defaults true)
        const dispute = await disputes.create(
          {
            orderId: rr.orderId,
            openedById: sellerUid ?? `seller_${params.sellerId}`,
            reason: `Satıcı iade reddi: ${params.reason}`,
            ...(params.description !== undefined && { description: params.description }),
          },
          tx,
        )
        await returnRequests.linkDispute(rr.id, dispute.id, tx)

        assertTransition('return_rejected', 'dispute_open')
        await orders.updateStatus(rr.orderId, 'dispute_open', tx as PrismaClient)
        await orders.appendStatusHistory(
          rr.orderId,
          'dispute_open' as never,
          `seller_${params.sellerId}`,
          'İade reddi uyuşmazlığa taşındı',
          tx as PrismaClient,
        )

        // Notify customer + admins
        await notifyCustomerReturnDecision(tx, rr, 'rejected', {
          eventKey: `return:${rr.id}:customer:receipt-rejected`,
          refundOutcome: 'under_review',
          sellerId: params.sellerId,
          disputeOpened: true,
          rejectionReason: params.description
            ? `${params.reason} — ${params.description}`
            : params.reason,
        })
        const admins = await tx.user.findMany({
          where: { role: 'admin' },
          select: { id: true },
        })
        for (const a of admins) {
          await recordNotification(tx, {
            eventKey: `return:${rr.id}:admin:dispute-opened:${a.id}`,
            userId: a.id,
            type: 'admin_dispute_opened',
            title: 'Yeni Uyuşmazlık (İade Reddi)',
            body: `#${params.returnRequestId.slice(-8)} iadesi satıcı tarafından reddedildi ve uyuşmazlığa taşındı.`,
            data: { orderId: rr.orderId, returnRequestId: rr.id, disputeId: dispute.id },
          })
        }
      }, TX_OPTIONS)

      return returnRequests.findById(params.returnRequestId)
    },

    /**
     * Admin reviews and approves/rejects the return request (override path).
     */
    async reviewRequest(params: {
      returnRequestId: string
      adminActorId: string
      decision: 'approved' | 'rejected'
      reviewNote?: string
    }) {
      return prisma.$transaction(async (tx) => {
        const returnRequest = await tx.returnRequest.findUnique({
          where: { id: params.returnRequestId },
          include: {
            items: { include: { orderLine: true } },
            order: { include: { lines: true, payments: true } },
          },
        })
        if (!returnRequest) throw new NotFoundError('ReturnRequest', params.returnRequestId)
        if (returnRequest.items.length > 0) {
          throw new ConflictError('Adet bazlı iadeler satıcı teslim kararı veya uyuşmazlık akışıyla yönetilir')
        }

        const newStatus = params.decision === 'approved' ? 'approved' : 'rejected'

        let updated = returnRequest
        await claimStatus(tx, returnRequest.id, returnRequest.status, async () => {
          updated = (await returnRequests.review(
            params.returnRequestId,
            {
              status: newStatus,
              reviewedBy: params.adminActorId,
              ...(params.reviewNote !== undefined && { reviewNote: params.reviewNote }),
            },
            tx,
          )) as typeof returnRequest
        })

        if (params.decision === 'approved') {
          await orders.updateStatus(returnRequest.orderId, 'return_approved', tx as PrismaClient)
          await orders.appendStatusHistory(
            returnRequest.orderId,
            'return_approved',
            params.adminActorId,
            params.reviewNote ?? 'İade onaylandı',
            tx as PrismaClient,
          )
        } else {
          await orders.updateStatus(returnRequest.orderId, 'return_rejected', tx as PrismaClient)
          await orders.appendStatusHistory(
            returnRequest.orderId,
            'return_rejected',
            params.adminActorId,
            params.reviewNote ?? 'İade reddedildi',
            tx as PrismaClient,
          )
        }

        await createAdminAuditLogRepository(tx as PrismaClient).createEntry({
          actorId: params.adminActorId,
          actionType: params.decision === 'approved' ? 'return_approved' : 'return_rejected',
          targetType: 'return_request',
          targetId: params.returnRequestId,
          previousData: { status: returnRequest.status },
          newData: { status: newStatus },
          ...(params.reviewNote !== undefined && { reason: params.reviewNote }),
        })

        // This first approval creates no refund record — the item has not come
        // back yet — so the customer must not be told a refund started.
        await notifyCustomerReturnDecision(tx, returnRequest, params.decision, {
          eventKey: `return:${returnRequest.id}:customer:review:${params.decision}`,
          refundOutcome: params.decision === 'approved' ? 'awaiting_return' : 'under_review',
          ...(params.reviewNote !== undefined ? { reviewNote: params.reviewNote } : {}),
          ...(params.decision === 'rejected' && params.reviewNote
            ? { rejectionReason: params.reviewNote }
            : {}),
        })

        return updated
      }, TX_OPTIONS)
    },

    /**
     * Mark item received and trigger refund — admin override action.
     * Uses the shared idempotent executeRefund.
     */
    async markItemReceived(params: {
      returnRequestId: string
      adminActorId: string
      refundAmount: Decimal
      adminIp?: string
    }) {
      const { refund } = await prisma.$transaction(async (tx) => {
        const rr = await tx.returnRequest.findUnique({
          where: { id: params.returnRequestId },
          include: {
            items: { include: { orderLine: true } },
            order: { include: { lines: true, payments: true } },
          },
        })
        if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)
        if (rr.items.length > 0) {
          throw new ConflictError('Adet bazlı iade bu eski admin akışıyla tamamlanamaz')
        }

        await claimStatus(tx, rr.id, rr.status, async () => {
          await orders.updateStatus(rr.orderId, 'return_received', tx as PrismaClient)
          await orders.updateStatus(rr.orderId, 'refund_pending', tx as PrismaClient)
        })

        const sellerId = resolveOrderSellerId(rr.order.lines)
        const refund = await refunds.executeReturnRefundInTransaction(tx, {
          returnRequestId: rr.id,
          orderId: rr.orderId,
          sellerId,
          refundAmount: params.refundAmount,
        })

        await createAdminAuditLogRepository(tx as PrismaClient).createEntry({
          actorId: params.adminActorId,
          actionType: 'return_approved',
          targetType: 'return_request',
          targetId: params.returnRequestId,
          previousData: { status: rr.status },
          newData: { status: 'refund_pending', refundAmount: params.refundAmount },
          reason: `İade alındı, ${params.refundAmount.toFixed(2)} TRY iade başlatıldı`,
        })

        await notifyCustomerReturnDecision(tx, rr, 'approved', {
          eventKey: `return:${rr.id}:customer:admin-refund`,
          refundOutcome: refundOutcomeOf(refund),
          sellerId,
          refundAmount: params.refundAmount,
        })

        return { refund }
      }, TX_OPTIONS)

      if (refund) await dispatchRefundProcessingAfterCommit(refund)

      return returnRequests.findById(params.returnRequestId)
    },

    /**
     * Müşteri, satıcı veya admin iade talebine mesaj ekler — opsiyonel ek görsel.
     * Konuşma reddedildikten/uyuşmazlığa taşındıktan sonra da devam eder;
     * yalnızca refund_completed terminal durumunda kapanır.
     */
    async addMessage(params: {
      returnRequestId: string
      authorId: string
      authorRole: UserRole
      body: string
      attachmentAssetIds?: string[]
    }) {
      const rr = await returnRequests.findById(params.returnRequestId)
      if (!rr) throw new NotFoundError('ReturnRequest', params.returnRequestId)

      if (rr.status === 'refund_completed') {
        throw new ConflictError('Tamamlanmış iade talebine mesaj eklenemez')
      }

      assertNoContactSharing(params.body)

      // Message + its attachments commit together; this path sends no e-mail.
      const message = await prisma.$transaction(async (tx) => {
        const created = await tx.returnMessage.create({
          data: {
            returnRequestId: params.returnRequestId,
            authorId: params.authorId,
            authorRole: params.authorRole,
            body: params.body,
          },
        })
        if (params.attachmentAssetIds?.length) {
          await linkAssets(tx, params.attachmentAssetIds, params.authorId, {
            returnMessageId: created.id,
          })
        }
        return created
      }, TX_OPTIONS)

      return prisma.returnMessage.findUnique({
        where: { id: message.id },
        include: { attachments: true },
      })
    },

    getRequest(id: string) {
      return returnRequests.findByIdWithOrder(id)
    },

    getRequestForSeller(id: string, sellerId: string) {
      return returnRequests.findByIdForSeller(id, sellerId)
    },

    listForAdmin(params: Parameters<typeof returnRequests.listForAdmin>[0]) {
      return returnRequests.listForAdmin(params)
    },

    listForSeller(params: Parameters<typeof returnRequests.listForSeller>[0]) {
      return returnRequests.listForSeller(params)
    },
  }
}

export type ReturnService = ReturnType<typeof createReturnService>
