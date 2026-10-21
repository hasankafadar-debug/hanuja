/**
 * Card Payment Service — iyzico standart sanal POS, 3D Secure, taksit (vade farkını müşteri öder).
 *
 * Kurallar (docs/05-security/payment-security.md §2 ve §7):
 * - Tutar hiçbir zaman istemciden alınmaz. İstemci yalnız taksit sayısı seçer; sunucu iyzico'dan
 *   alınan teklifi (CardPaymentQuote) kaydeder ve ödeme o teklife bağlanır.
 * - Para yalnız auth (v2) çağrısıyla çekilir. Auth'a geçiş sipariş satırı kilidi altında yapılır;
 *   süresi dolmuş deneme auth çağıramaz.
 * - Ağ hatası, zaman aşımı ve imzası doğrulanamayan yanıt "işlem gerçekleşmedi" sayılmaz
 *   (outcome_unknown / uncertain) ve mutabakata gider.
 * - Durum yalnız ileri gider; onaylı denemenin tekrar bildirimi yeni etki üretmez.
 * - Geç, ikinci veya doğrulanamayan tahsilat deneme bazlı geri ödemeye (CardAttemptReversal) düşer.
 * - Kart numarası ve CVC hiçbir tabloya, loga veya hataya yazılmaz.
 */
import crypto from 'node:crypto'
import type { CardPaymentAttempt, Prisma, PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import * as iyzicoAdapter from '../lib/iyzico'
import {
  toIyzicoPrice,
  verifyCallbackSignature,
  type CallbackFields,
  type IyzicoCard,
  type IyzicoOutcome,
  type IyzicoPaymentDetail,
} from '../lib/iyzico'
import { ConflictError, DomainError, NotFoundError, ValidationError } from '../lib/errors'
import { createCheckoutService } from './checkout.service'
import {
  DISTANCE_SALES_DOCUMENT_VERSION,
  PRE_INFORMATION_DOCUMENT_VERSION,
  hashLegalDocumentHtml,
  renderLegalDocuments,
  type LegalContractContext,
  type LegalDocumentBundle,
} from '../lib/legal-documents'
import type { LegalAcceptanceEvidence } from '../lib/legal-acceptance'
import {
  allocateCapturedItems,
  basketInstallmentLimit,
  buildCardBasket,
  resolveCategoryInstallmentLimit,
  roundCapturedPaidPrices,
  selectInstallmentOffers,
  type InstallmentOffer,
} from '../domain/card-installments'
import { assertTransition } from '../domain/order-state-machine'
import { firePaymentConfirmedNotifications, stampFulfillmentDueDates } from './payment.service'
import { postPaymentConfirmedSellerAccruals } from './seller-payment-accrual.service'
import { releaseOrderCouponUsage, releaseRemainingOrderLines } from './order-line-release'
import { wakeStockSearchProjection } from './product-stock-sync'
import {
  istanbulDay,
  lockOrderRow,
  lockQuoteRow,
  lockReversalRow,
  normalizeTurkishGsm,
  removePurchasedCartItems,
  splitFullName,
} from './card-payment-support'
import { formatOrderNumber } from '../lib/order-number'
import { createCheckoutFormService, type CheckoutFormGateway } from './checkout-form.service'

export type CardPaymentGateway = Pick<
  typeof iyzicoAdapter,
  | 'getInstallmentOptions'
  | 'initiate3DS'
  | 'complete3DS'
  | 'retrievePayment'
  | 'getPaymentReport'
  | 'cancelPayment'
  | 'refundPayment'
> &
  Partial<CheckoutFormGateway>

type CapturedAttempt = CardPaymentAttempt & { paidPrice: Decimal; installmentCount: number }

const QUOTE_TTL_MS = 15 * 60_000
/** Ödenmemiş kart siparişinin yeniden ödeme penceresi (iş kararı: 30 dk). */
export const CARD_PAYMENT_WINDOW_MS = 30 * 60_000
export const MAX_CARD_ATTEMPTS_PER_ORDER = 5
/** Auth isteği bu süreden eskiyse mutabakat sorgusu yapılır. */
const AUTH_RECONCILE_GRACE_MS = 60_000
/** Auth hiç tamamlanmamış (INIT/CALLBACK_THREEDS) denemenin başarısız sayılma süresi. */
const AUTH_NOT_COMPLETED_AFTER_MS = 15 * 60_000
/** Sonucu bilinmeyen geri ödeme, raporda iz yoksa bu süreden sonra yeniden denenir. */
const REVERSAL_RETRY_AFTER_MS = 60 * 60_000
const REVERSAL_MAX_ATTEMPTS = 5

const PRE_AUTH_STATUSES = ['initialized', 'threeds_pending'] as const
/** Bu durumlarda para çekilmiş olabilir: yeni deneme başlamaz, sipariş iptal edilmez. */
const BLOCKING_STATUSES = ['authorizing', 'outcome_unknown', 'fraud_review'] as const

export type CallbackOutcome = 'succeeded' | 'failed' | 'pending' | 'review' | 'expired' | 'invalid'

export type StartAttemptResult =
  | { kind: 'threeds'; attemptId: string; orderId: string; html: string }
  | {
      kind: 'existing'
      attemptId: string
      orderId: string
      status: CardPaymentAttempt['status']
    }

interface CardPaymentServiceDeps {
  prisma: PrismaClient
  gateway?: CardPaymentGateway
  now?: () => Date
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function providerIp() {
  return process.env.REFUND_PROVIDER_IP ?? '127.0.0.1'
}

function decimalNumber(value: Decimal) {
  return Number(value.toFixed(2))
}

function reviveLegalContext(value: Prisma.JsonValue): LegalContractContext {
  const context = value as unknown as LegalContractContext & {
    orderDate: string | Date
  }
  return { ...context, orderDate: new Date(context.orderDate) }
}

function outcomeForStatus(status: CardPaymentAttempt['status']): CallbackOutcome {
  switch (status) {
    case 'succeeded':
      return 'succeeded'
    case 'fraud_review':
      return 'review'
    case 'authorizing':
    case 'outcome_unknown':
    case 'checkout_form_pending':
      return 'pending'
    case 'expired':
      return 'expired'
    default:
      return 'failed'
  }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

export function createCardPaymentService({
  prisma,
  gateway = iyzicoAdapter,
  now = () => new Date(),
}: CardPaymentServiceDeps) {
  const checkout = createCheckoutService({ prisma })
  const checkoutForm = createCheckoutFormService({
    prisma,
    now,
    processCapturedPayment,
    expireOrder,
    gateway: {
      initializeCheckoutForm:
        gateway.initializeCheckoutForm ?? iyzicoAdapter.initializeCheckoutForm,
      retrieveCheckoutForm: gateway.retrieveCheckoutForm ?? iyzicoAdapter.retrieveCheckoutForm,
      retrievePayment: gateway.retrievePayment,
      getPaymentReport: gateway.getPaymentReport,
    },
  })

  async function appendEvent(
    client: Pick<Prisma.TransactionClient, 'paymentEvent'>,
    paymentId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) {
    await client.paymentEvent.create({
      data: { paymentId, eventType, payload: payload as Prisma.InputJsonValue },
    })
  }

  async function installmentLimitForOrder(orderId: string) {
    const [lines, categories] = await Promise.all([
      prisma.orderLine.findMany({
        where: { orderId },
        select: { product: { select: { categoryId: true } } },
      }),
      prisma.category.findMany({
        select: { id: true, parentId: true, maxInstallmentCount: true },
      }),
    ])
    const map = new Map(categories.map((category) => [category.id, category]))
    return basketInstallmentLimit(
      lines.map((line) => resolveCategoryInstallmentLimit(line.product.categoryId, map)),
    )
  }

  /** Bireysel TC vatandaşı dışındaki fatura profilleri iyzico teyidi gelene kadar kartla ödeyemez. */
  function resolveIdentityNumber(
    billing: {
      invoiceType: string | null
      isForeignNational: boolean
      tcNumber: string | null
    },
    provided: string | undefined,
  ) {
    if (billing.invoiceType === 'corporate' || billing.isForeignNational) {
      throw new DomainError(
        'Kurumsal veya yabancı uyruklu fatura bilgisiyle kartla ödeme henüz açık değil. Lütfen Havale / EFT seçin.',
        'CARD_IDENTITY_UNSUPPORTED',
        422,
      )
    }
    const identity = billing.tcNumber?.trim() || provided?.trim()
    if (!identity || !/^\d{11}$/.test(identity)) {
      throw new ValidationError('TC kimlik numarası 11 haneli olmalı')
    }
    return identity
  }

  // ─── Quote ────────────────────────────────────────────────────────────────

  async function quoteSource(params: {
    userId: string
    orderId?: string
    addressId?: string
    billingAddressId?: string
  }) {
    if (params.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: params.orderId, customerId: params.userId },
        include: { payments: true },
      })
      if (!order) throw new NotFoundError('Sipariş', params.orderId)
      assertOrderPayable(order)
      const firstQuote = await prisma.cardPaymentQuote.findFirst({
        where: { orderId: order.id, consumedAt: { not: null } },
        orderBy: { createdAt: 'asc' },
        select: { legalContext: true },
      })
      if (!firstQuote || !order.addressId) {
        throw new DomainError('Bu sipariş kartla yeniden ödenemez', 'CARD_ORDER_NOT_PAYABLE', 409)
      }
      return {
        orderId: order.id,
        price: order.totalAmount,
        sourceHash: sha256(`order:${order.id}:${order.totalAmount.toFixed(2)}`),
        addressId: order.addressId,
        billingAddressId: order.billingAddressId,
        legalContext: firstQuote.legalContext as Prisma.InputJsonValue,
        limit: await installmentLimitForOrder(order.id),
      }
    }
    if (!params.addressId) throw new ValidationError('Adres seçimi zorunludur')
    const draft = await checkout.buildDraft({
      userId: params.userId,
      addressId: params.addressId,
      ...(params.billingAddressId ? { billingAddressId: params.billingAddressId } : {}),
      paymentMethod: 'card',
    })
    return {
      orderId: null,
      price: draft.totalAmount,
      sourceHash: draftHash(draft, params.addressId, params.billingAddressId ?? null),
      addressId: params.addressId,
      billingAddressId: params.billingAddressId ?? null,
      legalContext: draft.legalContext as unknown as Prisma.InputJsonValue,
      limit: draft.installmentLimit,
    }
  }

  function draftHash(
    draft: Awaited<ReturnType<typeof checkout.buildDraft>>,
    addressId: string,
    billingAddressId: string | null,
  ) {
    return sha256(
      JSON.stringify({
        addressId,
        billingAddressId,
        coupon: draft.cart.couponCode,
        lines: draft.lines.map((line) => [
          line.productId,
          line.variantId,
          line.quantity,
          line.unitPrice.toFixed(2),
          line.customerPaidProductAmount.toFixed(2),
        ]),
        shipping: draft.shippingAmount.toFixed(2),
        total: draft.totalAmount.toFixed(2),
      }),
    )
  }

  function assertOrderPayable(order: {
    status: string
    cardPaymentExpiresAt: Date | null
    payments: Array<{ method: string; status: string }>
  }) {
    const cardPayment = order.payments.find((payment) => payment.method === 'card')
    if (
      order.status !== 'payment_pending' ||
      !cardPayment ||
      cardPayment.status !== 'pending' ||
      !order.cardPaymentExpiresAt ||
      order.cardPaymentExpiresAt <= now()
    ) {
      throw new DomainError(
        'Bu siparişin ödeme süresi doldu veya sipariş ödemeye açık değil.',
        'CARD_ORDER_NOT_PAYABLE',
        409,
      )
    }
  }

  async function fetchOffers(binNumber: string, price: Decimal, limit: number | null) {
    const outcome = await gateway.getInstallmentOptions({
      binNumber,
      price: toIyzicoPrice(price),
      conversationId: `quote-${crypto.randomUUID()}`,
    })
    if (outcome.kind !== 'success') {
      throw new DomainError(
        'Taksit seçenekleri şu anda alınamıyor. Lütfen biraz sonra tekrar deneyin.',
        'CARD_QUOTE_UNAVAILABLE',
        503,
      )
    }
    const info = outcome.data
    const selection = selectInstallmentOffers({
      price,
      offers: info?.options ?? null,
      cardType: info?.cardType ?? null,
      limit,
    })
    if (!selection.ok) {
      throw new DomainError(
        'Bu kartla ödeme seçeneği sunulamıyor. Başka bir kart veya Havale / EFT deneyin.',
        'CARD_NO_OFFER',
        422,
        { reason: selection.reason },
      )
    }
    return { info, offers: selection.offers }
  }

  function presentOffers(price: Decimal, offers: InstallmentOffer[]) {
    return offers.map((offer) => ({
      installmentNumber: offer.installmentNumber,
      installmentPrice: new Decimal(offer.installmentPrice).toFixed(2),
      totalPrice: new Decimal(offer.totalPrice).toFixed(2),
      differenceAmount: new Decimal(offer.totalPrice).sub(price).toFixed(2),
    }))
  }

  function quoteContext(
    quote: {
      legalContext: Prisma.JsonValue
      installmentCount: number
      price: Decimal
      paidPrice: Decimal
    },
    extra?: { orderNumber: string; orderDate: Date },
  ): LegalContractContext {
    const base = reviveLegalContext(quote.legalContext)
    return {
      ...base,
      ...(extra ? { orderNumber: extra.orderNumber, orderDate: extra.orderDate } : {}),
      paymentMethod: 'card',
      installmentCount: quote.installmentCount,
      installmentDifferenceAmount: decimalNumber(quote.paidPrice.sub(quote.price)),
      totalAmount: decimalNumber(quote.paidPrice),
    }
  }

  // ─── Callback / capture helpers ───────────────────────────────────────────

  async function transitionAttempt(
    attemptId: string,
    from: readonly CardPaymentAttempt['status'][],
    data: Prisma.CardPaymentAttemptUpdateManyMutationInput,
  ) {
    const result = await prisma.cardPaymentAttempt.updateMany({
      where: { id: attemptId, status: { in: [...from] } },
      data,
    })
    return result.count === 1
  }

  function bindingProblem(attempt: CardPaymentAttempt, detail: IyzicoPaymentDetail): string | null {
    if (!attempt.providerPaymentId || detail.paymentId !== attempt.providerPaymentId) {
      return 'payment_id_mismatch'
    }
    if (attempt.flow === 'checkout_form') {
      if (!attempt.legalSnapshots) return 'legal_evidence_missing'
      if (detail.basketId !== attempt.orderId) return 'basket_mismatch'
      if (detail.currency !== 'TRY') return 'currency_mismatch'
      if (detail.conversationId !== attempt.conversationId) return 'conversation_mismatch'
      if (!detail.installment || !attempt.allowedInstallments.includes(detail.installment))
        return 'installment_mismatch'
      if (detail.mdStatus !== '1') return 'md_status_not_verified'
      if (new Decimal(detail.paidPrice).lt(attempt.price)) return 'paid_price_mismatch'
      if (detail.installment === 1 && !new Decimal(detail.paidPrice).eq(attempt.price))
        return 'paid_price_mismatch'
      if (!new Decimal(detail.price).eq(attempt.price)) return 'price_mismatch'
      if (attempt.supersededAt) return 'superseded_capture'
      return null
    }
    if (detail.basketId !== null && detail.basketId !== attempt.orderId) return 'basket_mismatch'
    if (detail.currency !== null && detail.currency !== 'TRY') return 'currency_mismatch'
    if (!new Decimal(detail.price).eq(attempt.price)) return 'price_mismatch'
    if (!attempt.paidPrice || !new Decimal(detail.paidPrice).eq(attempt.paidPrice))
      return 'paid_price_mismatch'
    if (detail.installment !== null && detail.installment !== attempt.installmentCount) {
      return 'installment_mismatch'
    }
    if (detail.mdStatus !== null && detail.mdStatus !== '1') return 'md_status_not_verified'
    return null
  }

  function cardSummary(
    detail: IyzicoPaymentDetail,
    price: Decimal,
  ): Prisma.CardPaymentAttemptUpdateInput {
    return {
      paidPrice: new Decimal(detail.paidPrice),
      installmentDifferenceAmount: new Decimal(detail.paidPrice).sub(price),
      installmentCount: detail.installment,
      ...(detail.binNumber ? { binNumber: detail.binNumber } : {}),
      ...(detail.lastFourDigits ? { lastFourDigits: detail.lastFourDigits } : {}),
      ...(detail.cardType ? { cardType: detail.cardType } : {}),
      ...(detail.cardAssociation ? { cardAssociation: detail.cardAssociation } : {}),
      ...(detail.cardFamily ? { cardFamily: detail.cardFamily } : {}),
      ...(detail.iyziCommissionFee
        ? { iyziCommissionFee: new Decimal(detail.iyziCommissionFee) }
        : {}),
      ...(detail.iyziCommissionRateAmount
        ? {
            iyziCommissionRateAmount: new Decimal(detail.iyziCommissionRateAmount),
          }
        : {}),
      ...(detail.merchantPayoutAmount
        ? { merchantPayoutAmount: new Decimal(detail.merchantPayoutAmount) }
        : {}),
      fraudStatus: detail.fraudStatus,
      ...(detail.mdStatus !== null ? { mdStatus: detail.mdStatus } : {}),
      itemTransactions: detail.itemTransactions.map((item) => ({
        itemId: item.itemId,
        paymentTransactionId: item.paymentTransactionId,
        price: item.price,
        paidPrice: item.paidPrice,
      })) as Prisma.InputJsonValue,
    }
  }

  /**
   * Tahsil edilmiş ama siparişe bağlanamayan ödeme: deneme `succeeded` (para çekildi) olur ve
   * deneme başına tek geri ödeme kaydı açılır.
   */
  async function recordUnusableCapture(
    tx: Prisma.TransactionClient,
    attempt: CardPaymentAttempt,
    detail: IyzicoPaymentDetail,
    reason: string,
  ) {
    await tx.cardPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        ...cardSummary(detail, attempt.price),
        status: 'succeeded',
        installmentDifferenceAmount: new Decimal(detail.paidPrice).sub(attempt.price),
        completedAt: now(),
        errorCode: reason,
      },
    })
    const capturedAt = attempt.authRequestedAt ?? attempt.createdAt
    // Kalem tutarları kuruşa yuvarlanır ve toplamları tahsil edilen tutara eşit kalır; toplam
    // tutmayan (uyuşmaz) bir tahsilatta her kalem ayrı yuvarlanır.
    const rawPaidPrices = detail.itemTransactions.map((item) => String(item.paidPrice))
    const amounts =
      roundCapturedPaidPrices(rawPaidPrices, new Decimal(detail.paidPrice)) ??
      rawPaidPrices.map((value) => new Decimal(value).toDecimalPlaces(2))
    const items = detail.itemTransactions.map((item, index) => ({
      paymentTransactionId: item.paymentTransactionId,
      amount: amounts[index]!.toFixed(2),
      refundedAmount: '0.00',
    }))
    await tx.cardAttemptReversal.upsert({
      where: { attemptId: attempt.id },
      update: {},
      create: {
        attemptId: attempt.id,
        kind: istanbulDay(capturedAt) === istanbulDay(now()) ? 'cancel' : 'refund',
        reason,
        amount: new Decimal(detail.paidPrice),
        items: items as Prisma.InputJsonValue,
      },
    })
    await appendEvent(tx, attempt.paymentId, 'card_capture_reversal_required', {
      attemptId: attempt.id,
      providerPaymentId: detail.paymentId,
      reason,
    })
  }

  async function confirmInTransaction(
    tx: Prisma.TransactionClient,
    attempt: CapturedAttempt,
    detail: IyzicoPaymentDetail,
  ): Promise<CallbackOutcome> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: attempt.orderId },
      include: { lines: true, payments: true },
    })
    const payment = order.payments.find((candidate) => candidate.id === attempt.paymentId)
    if (!payment) throw new NotFoundError('Payment', attempt.paymentId)

    if (payment.status === 'confirmed' && payment.providerPaymentId === attempt.providerPaymentId) {
      await tx.cardPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'succeeded',
          completedAt: attempt.completedAt ?? now(),
        },
      })
      return 'succeeded'
    }

    const confirmable =
      order.status === 'payment_pending' &&
      payment.status === 'pending' &&
      order.totalAmount.eq(attempt.price)
    if (!confirmable) {
      await recordUnusableCapture(
        tx,
        attempt,
        detail,
        payment.status === 'confirmed' ? 'duplicate_capture' : 'late_capture',
      )
      return 'failed'
    }

    const providerItems = await tx.paymentProviderItem.findMany({
      where: { paymentId: payment.id },
    })
    const allocation = allocateCapturedItems({
      expected: providerItems.map((item) => ({
        providerItemId: item.providerItemId,
        amount: item.amount,
      })),
      captured: detail.itemTransactions,
      price: attempt.price,
      paidPrice: attempt.paidPrice,
    })
    if (!allocation.ok) {
      await recordUnusableCapture(tx, attempt, detail, `item_${allocation.reason}`)
      return 'failed'
    }

    const confirmedAt = now()
    let customerPaidShippingAmount: Decimal | null = null
    for (const item of allocation.items) {
      const providerItem = providerItems.find(
        (candidate) => candidate.providerItemId === item.providerItemId,
      )!
      await tx.paymentProviderItem.update({
        where: { id: providerItem.id },
        data: {
          providerTransactionId: item.paymentTransactionId,
          amount: item.paidPrice,
          providerData: {
            paymentTransactionId: item.paymentTransactionId,
            price: item.basePrice.toFixed(2),
            paidPrice: item.paidPrice.toFixed(2),
          } as Prisma.InputJsonValue,
        },
      })
      if (providerItem.kind === 'product' && providerItem.orderLineId) {
        // Satırın müşteri tutarı vade farkı payını içerir; iade hesapları (allocateProductRefund)
        // bu tutardan oransal pay alır. Tasarımcı alanları (totalPrice, kupon, komisyon) değişmez.
        await tx.orderLine.update({
          where: { id: providerItem.orderLineId },
          data: { customerPaidProductAmount: item.paidPrice },
        })
      } else if (providerItem.kind === 'shipping') {
        customerPaidShippingAmount = item.paidPrice
      }
    }

    assertTransition(order.status, 'payment_confirmed')
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: 'payment_confirmed',
        paymentConfirmedAt: confirmedAt,
        totalAmount: attempt.paidPrice,
        installmentCount: attempt.installmentCount,
        installmentDifferenceAmount: attempt.paidPrice.sub(attempt.price),
        installmentTotalAmount: attempt.paidPrice,
        ...(customerPaidShippingAmount ? { customerPaidShippingAmount } : {}),
      },
    })
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'confirmed',
        confirmedAt,
        providerPaymentId: attempt.providerPaymentId,
        amount: attempt.paidPrice,
        providerData: {
          attemptId: attempt.id,
          installment: attempt.installmentCount,
          cardFamily: detail.cardFamily,
          cardAssociation: detail.cardAssociation,
          lastFourDigits: detail.lastFourDigits,
          fraudStatus: detail.fraudStatus,
        } as Prisma.InputJsonValue,
      },
    })
    await tx.cardPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        ...cardSummary(detail, attempt.price),
        status: 'succeeded',
        completedAt: confirmedAt,
        installmentDifferenceAmount: attempt.paidPrice.sub(attempt.price),
      },
    })

    // Sözleşme: başarılı denemenin müşteriye gösterilen ve kabul edilen belgeleri.
    const quote = attempt.quoteId
      ? await tx.cardPaymentQuote.findUniqueOrThrow({
          where: { id: attempt.quoteId },
        })
      : null
    const bundle =
      attempt.flow === 'checkout_form' && attempt.legalSnapshots
        ? (attempt.legalSnapshots as unknown as Pick<
            LegalDocumentBundle,
            'buyerSnapshot' | 'sellerSnapshot' | 'platformSnapshot'
          >)
        : renderLegalDocuments(
            quoteContext(quote!, {
              orderNumber: formatOrderNumber(order.publicNumber, order.id),
              orderDate: order.createdAt,
            }),
          )
    const existingSnapshot = await tx.orderLegalSnapshot.findUnique({
      where: { orderId: order.id },
    })
    if (!existingSnapshot) {
      await tx.orderLegalSnapshot.create({
        data: {
          orderId: order.id,
          distanceSalesHtml: attempt.distanceSalesHtml,
          preInformationHtml: attempt.preInformationHtml,
          distanceSalesVersion: attempt.distanceSalesVersion,
          preInformationVersion: attempt.preInformationVersion,
          distanceSalesHash: attempt.distanceSalesHash,
          preInformationHash: attempt.preInformationHash,
          acceptedDistanceSalesAt: attempt.acceptedAt,
          acceptedPreInformationAt: attempt.acceptedAt,
          acceptedIp: attempt.acceptedIp,
          acceptedUserAgent: attempt.acceptedUserAgent,
          acceptedSessionId: attempt.acceptedSessionId,
          buyerSnapshot: bundle.buyerSnapshot as unknown as Prisma.InputJsonValue,
          sellerSnapshot: bundle.sellerSnapshot as unknown as Prisma.InputJsonValue,
          platformSnapshot: bundle.platformSnapshot as unknown as Prisma.InputJsonValue,
        },
      })
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: 'payment_pending',
        toStatus: 'payment_confirmed',
        actorId: 'system',
        reason:
          attempt.installmentCount > 1
            ? `Kart ödemesi onaylandı (${attempt.installmentCount} taksit). Ref: ${attempt.providerPaymentId}`
            : `Kart ödemesi onaylandı. Ref: ${attempt.providerPaymentId}`,
      },
    })
    assertTransition('payment_confirmed', 'seller_queue_ready')
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'seller_queue_ready', sellerQueueReadyAt: confirmedAt },
    })
    await stampFulfillmentDueDates(tx, order.id, confirmedAt)
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: 'payment_confirmed',
        toStatus: 'seller_queue_ready',
        actorId: 'system',
        reason: 'Tasarımcı kuyruğuna düştü',
      },
    })
    await removePurchasedCartItems(tx, order.customerId, order.lines)
    await postPaymentConfirmedSellerAccruals({
      prisma,
      tx,
      orderId: order.id,
      effectiveAt: confirmedAt,
      actorId: 'system',
    })
    // Tutarlar güncellendikten sonra: e-postadaki toplam vade farkını içerir.
    await firePaymentConfirmedNotifications(tx, order.id)
    await appendEvent(tx, payment.id, 'card_payment_confirmed', {
      attemptId: attempt.id,
      providerPaymentId: attempt.providerPaymentId,
      installmentCount: attempt.installmentCount,
      price: attempt.price.toFixed(2),
      paidPrice: attempt.paidPrice.toFixed(2),
      fraudStatus: detail.fraudStatus,
    })
    return 'succeeded'
  }

  /** iyzico'nun tahsilat bildirdiği ödemeyi (auth, sorgu veya webhook) işler. */
  async function processCapturedPayment(
    attemptId: string,
    detail: IyzicoPaymentDetail,
  ): Promise<CallbackOutcome> {
    const outcome = await prisma.$transaction(async (tx) => {
      const initial = await tx.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      })
      await lockOrderRow(tx, initial.orderId)
      const attempt = await tx.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: attemptId },
      })

      if (
        attempt.status === 'succeeded' ||
        attempt.status === 'voided' ||
        attempt.status === 'refunded' ||
        attempt.status === 'refunded_by_provider'
      ) {
        return outcomeForStatus(attempt.status)
      }

      const problem = bindingProblem(attempt, detail)
      if (problem) {
        if (problem === 'payment_id_mismatch') {
          // Başka bir ödemeye ait yanıt: bu denemeye dokunulmaz, iz bırakılır.
          await appendEvent(tx, attempt.paymentId, 'card_capture_payment_mismatch', {
            attemptId: attempt.id,
            receivedPaymentId: detail.paymentId,
          })
          return 'invalid' as const
        }
        await recordUnusableCapture(tx, attempt, detail, problem)
        return 'failed' as const
      }

      if (detail.fraudStatus === -1) {
        // iyzico inceleme sonrası reddettiğinde ödemeyi kendisi iade eder; bizden iade gönderilmez.
        await tx.cardPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            ...cardSummary(detail, attempt.price),
            installmentDifferenceAmount: new Decimal(detail.paidPrice).sub(attempt.price),
            status: 'failed',
            errorCode: 'fraud_rejected',
          },
        })
        await appendEvent(tx, attempt.paymentId, 'card_payment_fraud_rejected', {
          attemptId: attempt.id,
          providerPaymentId: detail.paymentId,
        })
        return 'failed' as const
      }

      if (detail.fraudStatus !== 1 && detail.fraudStatus !== 2) {
        // 0 (inceleniyor) veya bilinmiyor: sipariş ilerlemez, tahakkuk yazılmaz.
        await tx.cardPaymentAttempt.update({
          where: { id: attempt.id },
          data: { ...cardSummary(detail, attempt.price), status: 'fraud_review' },
        })
        if (attempt.status !== 'fraud_review') {
          await appendEvent(tx, attempt.paymentId, 'card_payment_fraud_review', {
            attemptId: attempt.id,
            providerPaymentId: detail.paymentId,
          })
        }
        return 'review' as const
      }

      const paidPrice = new Decimal(detail.paidPrice)
      const installmentCount = detail.installment ?? attempt.installmentCount
      if (!installmentCount) return 'invalid' as const
      return confirmInTransaction(tx, { ...attempt, paidPrice, installmentCount }, detail)
    })

    if (outcome === 'succeeded') await wakeStockSearchProjection()
    // Geri ödeme gerekiyorsa hemen denenir; başarısızlıkta worker devralır.
    const reversal = await prisma.cardAttemptReversal.findUnique({
      where: { attemptId },
    })
    if (reversal && reversal.status === 'pending') {
      await processReversal(reversal.id).catch((error) =>
        console.error('[card-payment] geri ödeme hemen işlenemedi', {
          reversalId: reversal.id,
          message: error instanceof Error ? error.message : 'unknown',
        }),
      )
    }
    return outcome
  }

  async function applyAuthOutcome(
    attempt: CardPaymentAttempt,
    outcome: IyzicoOutcome<IyzicoPaymentDetail>,
  ): Promise<CallbackOutcome> {
    if (outcome.kind === 'unknown') {
      await transitionAttempt(attempt.id, ['authorizing'], {
        status: 'outcome_unknown',
        errorMessage: outcome.reason.slice(0, 500),
      })
      await appendEvent(prisma, attempt.paymentId, 'card_auth_outcome_unknown', {
        attemptId: attempt.id,
        reason: outcome.reason,
      })
      return 'pending'
    }
    if (outcome.kind === 'failure') {
      await transitionAttempt(attempt.id, ['authorizing', 'outcome_unknown'], {
        status: 'failed',
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage.slice(0, 500),
        completedAt: now(),
      })
      await appendEvent(prisma, attempt.paymentId, 'card_auth_failed', {
        attemptId: attempt.id,
        errorCode: outcome.errorCode ?? null,
        errorMessage: outcome.errorMessage,
      })
      return 'failed'
    }
    return processCapturedPayment(attempt.id, outcome.data)
  }

  // ─── Reversals ────────────────────────────────────────────────────────────

  type ReversalItem = {
    paymentTransactionId: string
    amount: string
    refundedAmount: string
  }

  async function completeReversal(
    reversalId: string,
    attemptStatus: 'voided' | 'refunded',
    providerReference: string | null,
  ) {
    await prisma.$transaction(async (tx) => {
      const reversal = await tx.cardAttemptReversal.update({
        where: { id: reversalId },
        data: { status: 'completed', completedAt: now(), providerReference, lastError: null },
      })
      const attempt = await tx.cardPaymentAttempt.update({
        where: { id: reversal.attemptId },
        data: { status: attemptStatus },
      })
      await appendEvent(tx, attempt.paymentId, 'card_capture_reversed', {
        attemptId: attempt.id,
        reversalId,
        kind: reversal.kind,
        amount: reversal.amount.toFixed(2),
      })
    })
  }

  async function processReversal(reversalId: string): Promise<void> {
    const claimed = await prisma.$transaction(async (tx) => {
      await lockReversalRow(tx, reversalId)
      const reversal = await tx.cardAttemptReversal.findUniqueOrThrow({
        where: { id: reversalId },
      })
      if (reversal.status !== 'pending') return null
      if (reversal.attemptCount >= REVERSAL_MAX_ATTEMPTS) {
        await tx.cardAttemptReversal.update({
          where: { id: reversalId },
          data: { status: 'manual_required' },
        })
        return null
      }
      return tx.cardAttemptReversal.update({
        where: { id: reversalId },
        data: {
          status: 'processing',
          attemptCount: { increment: 1 },
          lastAttemptAt: now(),
        },
        include: { attempt: true },
      })
    })
    if (!claimed || !claimed.attempt.providerPaymentId) return
    const attempt = claimed.attempt

    if (claimed.kind === 'cancel') {
      const outcome = await gateway.cancelPayment({
        paymentId: attempt.providerPaymentId!,
        conversationId: `rev-${claimed.id}-cancel`,
        ip: providerIp(),
        reason: claimed.reason === 'duplicate_capture' ? 'double_payment' : 'other',
        description: claimed.reason,
      })
      if (outcome.kind === 'success') {
        await completeReversal(claimed.id, 'voided', null)
      } else if (outcome.kind === 'failure') {
        // Gün sonu geçmiş olabilir: kalem bazlı iadeye geçilir.
        await prisma.cardAttemptReversal.update({
          where: { id: claimed.id },
          data: {
            kind: 'refund',
            status: 'pending',
            lastError: outcome.errorMessage.slice(0, 500),
          },
        })
      } else {
        await prisma.cardAttemptReversal.update({
          where: { id: claimed.id },
          data: {
            status: 'uncertain',
            lastError: outcome.reason.slice(0, 500),
          },
        })
      }
      return
    }

    const items = claimed.items as unknown as ReversalItem[]
    for (const item of items) {
      const remaining = new Decimal(item.amount).sub(item.refundedAmount)
      if (remaining.lte(0)) continue
      let result: Awaited<ReturnType<CardPaymentGateway['refundPayment']>>
      try {
        result = await gateway.refundPayment({
          paymentTransactionId: item.paymentTransactionId,
          price: toIyzicoPrice(remaining),
          conversationId: `rev-${claimed.id}-${item.paymentTransactionId}`,
          ip: providerIp(),
        })
      } catch (error) {
        await prisma.cardAttemptReversal.update({
          where: { id: claimed.id },
          data: {
            status: 'uncertain',
            lastError: error instanceof Error ? error.message.slice(0, 500) : 'bağlantı hatası',
          },
        })
        return
      }
      if (result.uncertain || (!result.success && !result.errorCode)) {
        await prisma.cardAttemptReversal.update({
          where: { id: claimed.id },
          data: {
            status: 'uncertain',
            lastError: result.errorMessage ?? 'sonuç belirsiz',
          },
        })
        return
      }
      if (!result.success) {
        await prisma.cardAttemptReversal.update({
          where: { id: claimed.id },
          data: {
            status: claimed.attemptCount >= REVERSAL_MAX_ATTEMPTS ? 'manual_required' : 'pending',
            lastError: (result.errorMessage ?? result.errorCode ?? 'iade reddedildi').slice(0, 500),
          },
        })
        return
      }
      item.refundedAmount = item.amount
      await prisma.cardAttemptReversal.update({
        where: { id: claimed.id },
        data: { items: items as unknown as Prisma.InputJsonValue },
      })
    }
    await completeReversal(claimed.id, 'refunded', null)
  }

  /**
   * Sonucu belirsiz geri ödeme: raporlama servisinde bizim conversationId'lerimizle iz aranır.
   * İz yoksa ve yeterince zaman geçtiyse yeniden denemeye alınır (körlemesine değil).
   */
  async function reconcileReversal(reversalId: string): Promise<void> {
    const reversal = await prisma.cardAttemptReversal.findUniqueOrThrow({
      where: { id: reversalId },
      include: { attempt: true },
    })
    if (
      reversal.status !== 'uncertain' &&
      reversal.status !== 'processing' &&
      reversal.status !== 'manual_required'
    ) {
      return
    }
    const report = await gateway.getPaymentReport({
      paymentConversationId: reversal.attempt.conversationId,
      conversationId: `rec-${reversal.id}`,
    })
    if (report.kind !== 'success') return
    const payment = report.data.find(
      (entry) => entry.paymentId === reversal.attempt.providerPaymentId,
    )
    if (!payment) return

    if (reversal.kind === 'cancel') {
      const cancelled =
        payment.refundStatus === 'TOTALLY_REFUNDED' ||
        payment.refunds.some(
          (entry) =>
            entry.scope === 'cancel' && entry.conversationId === `rev-${reversal.id}-cancel`,
        )
      if (cancelled) return completeReversal(reversal.id, 'voided', null)
    } else {
      const items = reversal.items as unknown as ReversalItem[]
      for (const item of items) {
        const found = payment.refunds.some(
          (entry) =>
            entry.scope === 'refund' &&
            entry.conversationId === `rev-${reversal.id}-${item.paymentTransactionId}`,
        )
        if (found) item.refundedAmount = item.amount
      }
      await prisma.cardAttemptReversal.update({
        where: { id: reversal.id },
        data: { items: items as unknown as Prisma.InputJsonValue },
      })
      if (items.every((item) => new Decimal(item.refundedAmount).gte(item.amount))) {
        return completeReversal(reversal.id, 'refunded', null)
      }
    }

    const lastAttemptAt = reversal.lastAttemptAt ?? reversal.updatedAt
    if (
      reversal.status !== 'manual_required' &&
      now().getTime() - lastAttemptAt.getTime() >= REVERSAL_RETRY_AFTER_MS
    ) {
      await prisma.cardAttemptReversal.update({
        where: { id: reversal.id },
        data: {
          status: reversal.attemptCount >= REVERSAL_MAX_ATTEMPTS ? 'manual_required' : 'pending',
        },
      })
    }
  }

  // ─── Reconcile / expiry ───────────────────────────────────────────────────

  async function reconcileAttempt(attemptId: string): Promise<CallbackOutcome | null> {
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    })
    if (attempt.flow === 'checkout_form') return checkoutForm.reconcile(attemptId)
    if (!(BLOCKING_STATUSES as readonly string[]).includes(attempt.status)) return null
    if (!attempt.providerPaymentId) return null
    if (
      attempt.status === 'authorizing' &&
      attempt.authRequestedAt &&
      now().getTime() - attempt.authRequestedAt.getTime() < AUTH_RECONCILE_GRACE_MS
    ) {
      return null
    }

    const outcome = await gateway.retrievePayment({
      paymentId: attempt.providerPaymentId,
      paymentConversationId: attempt.conversationId,
      conversationId: `rec-${attempt.id}`,
    })
    if (outcome.kind !== 'success') {
      if (attempt.status === 'authorizing') {
        await transitionAttempt(attempt.id, ['authorizing'], {
          status: 'outcome_unknown',
        })
      }
      return 'pending'
    }
    const detail = outcome.data
    if (detail.paymentId !== attempt.providerPaymentId) return 'invalid'
    const paymentStatus = (detail.paymentStatus ?? '').toUpperCase()

    if (paymentStatus === 'SUCCESS') {
      if (detail.fraudStatus === -1 && attempt.status === 'fraud_review') {
        await transitionAttempt(attempt.id, ['fraud_review'], {
          status: 'refunded_by_provider',
          fraudStatus: -1,
          completedAt: now(),
        })
        await appendEvent(prisma, attempt.paymentId, 'card_payment_fraud_rejected', {
          attemptId: attempt.id,
          providerPaymentId: detail.paymentId,
        })
        return 'failed'
      }
      return processCapturedPayment(attempt.id, detail)
    }
    if (paymentStatus === 'FAILURE') {
      await transitionAttempt(attempt.id, [...BLOCKING_STATUSES], {
        status: 'failed',
        errorCode: 'provider_failure',
        completedAt: now(),
      })
      return 'failed'
    }
    // INIT_THREEDS / CALLBACK_THREEDS: auth tamamlanmamış, para çekilmemiş.
    const authAt = attempt.authRequestedAt ?? attempt.updatedAt
    if (now().getTime() - authAt.getTime() >= AUTH_NOT_COMPLETED_AFTER_MS) {
      await transitionAttempt(attempt.id, ['authorizing', 'outcome_unknown'], {
        status: 'failed',
        errorCode: 'auth_not_completed',
        completedAt: now(),
      })
      return 'failed'
    }
    return 'pending'
  }

  async function expireOrder(orderId: string): Promise<'cancelled' | 'blocked' | 'skipped'> {
    const result = await prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId)
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: true, cardPaymentAttempts: true },
      })
      if (
        !order ||
        order.status !== 'payment_pending' ||
        !order.cardPaymentExpiresAt ||
        order.cardPaymentExpiresAt > now()
      ) {
        return 'skipped' as const
      }
      await tx.cardPaymentAttempt.updateMany({
        where: { orderId, status: { in: [...PRE_AUTH_STATUSES] } },
        data: { status: 'expired', completedAt: now() },
      })
      const blocking = order.cardPaymentAttempts.some(
        (attempt) =>
          !attempt.supersededAt &&
          ((BLOCKING_STATUSES as readonly string[]).includes(attempt.status) ||
            (attempt.flow === 'checkout_form' &&
              !!attempt.checkoutFormExpiresAt &&
              attempt.checkoutFormExpiresAt > now())),
      )
      const payment = order.payments.find((candidate) => candidate.method === 'card')
      if (blocking || !payment) return 'blocked' as const
      await tx.cardPaymentAttempt.updateMany({
        where: { orderId, flow: 'checkout_form', status: 'checkout_form_pending' },
        data: { status: 'expired', completedAt: now() },
      })

      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: 'pending' },
        data: { status: 'cancelled', failedAt: now() },
      })
      if (claimed.count !== 1) return 'skipped' as const

      assertTransition(order.status, 'payment_cancelled')
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'payment_cancelled',
          cancelledAt: now(),
          cancellationReason: 'payment_failed',
        },
      })
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'payment_pending',
          toStatus: 'payment_cancelled',
          actorId: 'system',
          reason: 'Kart ödemesi süresi içinde tamamlanmadı',
        },
      })
      // Tahsilat yok: iade veya tasarımcı cari kaydı yazılmaz; stok ve kupon geri verilir.
      await releaseRemainingOrderLines(tx, orderId)
      await releaseOrderCouponUsage(tx, orderId)
      await appendEvent(tx, payment.id, 'card_payment_expired', { orderId })
      return 'cancelled' as const
    })
    if (result === 'cancelled') await wakeStockSearchProjection()
    return result
  }

  /** Webhook kaydını işler: ilgili denemeyi iyzico sorgusuyla mutabakata sokar. */
  async function processWebhookEvent(eventId: string) {
    const event = await prisma.iyzicoWebhookEvent.findUnique({
      where: { id: eventId },
    })
    if (!event || event.processedAt) return
    try {
      const attempt = event.checkoutFormToken
        ? await prisma.cardPaymentAttempt.findUnique({
            where: { checkoutFormToken: event.checkoutFormToken },
          })
        : event.paymentConversationId
          ? await prisma.cardPaymentAttempt.findUnique({
              where: { conversationId: event.paymentConversationId },
            })
          : null
      let note: string | null = null
      if (!attempt) {
        note = 'no_attempt'
      } else if (
        event.paymentId &&
        attempt.providerPaymentId &&
        event.paymentId !== attempt.providerPaymentId
      ) {
        note = 'payment_id_mismatch'
      } else if (
        attempt.flow === 'checkout_form' ||
        (BLOCKING_STATUSES as readonly string[]).includes(attempt.status)
      ) {
        // Bildirim yalnız tetikleyicidir; karar iyzico'nun imzalı sorgu yanıtıyla verilir.
        if (attempt.status === 'authorizing') {
          await transitionAttempt(attempt.id, ['authorizing'], {
            status: 'outcome_unknown',
          })
        }
        await reconcileAttempt(attempt.id)
      }
      await prisma.iyzicoWebhookEvent.update({
        where: { id: event.id },
        data: {
          processedAt: now(),
          attempts: { increment: 1 },
          lastError: note,
        },
      })
    } catch (error) {
      await prisma.iyzicoWebhookEvent.update({
        where: { id: event.id },
        data: {
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        },
      })
      throw error
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    previewCheckoutForm: checkoutForm.preview,
    startCheckoutForm: checkoutForm.start,
    reuseCheckoutForm: checkoutForm.reuse,
    abandonCheckoutForm: checkoutForm.abandon,
    async handleCheckoutFormCallback(token: string) {
      const attempt = await prisma.cardPaymentAttempt.findUnique({
        where: { checkoutFormToken: token },
      })
      if (!attempt) return { orderId: null, outcome: 'invalid' as const }
      return { orderId: attempt.orderId, outcome: await checkoutForm.reconcile(attempt.id) }
    },
    async createQuote(params: {
      userId: string
      binNumber: string
      installmentCount: number
      addressId?: string
      billingAddressId?: string
      orderId?: string
    }) {
      if (!/^\d{8}$/.test(params.binNumber)) {
        throw new ValidationError('Kart numarasının ilk 8 hanesi gerekli')
      }
      if (
        !Number.isInteger(params.installmentCount) ||
        params.installmentCount < 1 ||
        params.installmentCount > 36
      ) {
        throw new ValidationError('Geçersiz taksit sayısı')
      }
      const source = await quoteSource(params)
      const { info, offers } = await fetchOffers(params.binNumber, source.price, source.limit)
      const chosen = offers.find((offer) => offer.installmentNumber === params.installmentCount)
      if (!chosen) throw new ValidationError('Seçilen taksit bu kart için kullanılamıyor')

      const quote = await prisma.cardPaymentQuote.create({
        data: {
          userId: params.userId,
          ...(source.orderId ? { orderId: source.orderId } : {}),
          addressId: source.addressId,
          ...(source.billingAddressId ? { billingAddressId: source.billingAddressId } : {}),
          sourceHash: source.sourceHash,
          binNumber: params.binNumber,
          installmentCount: chosen.installmentNumber,
          price: source.price,
          paidPrice: new Decimal(chosen.totalPrice),
          installmentPrice: new Decimal(chosen.installmentPrice),
          cardType: info?.cardType ?? null,
          cardAssociation: info?.cardAssociation ?? null,
          cardFamily: info?.cardFamily ?? null,
          bankName: info?.bankName ?? null,
          distanceSalesVersion: DISTANCE_SALES_DOCUMENT_VERSION,
          preInformationVersion: PRE_INFORMATION_DOCUMENT_VERSION,
          legalContext: source.legalContext,
          expiresAt: new Date(now().getTime() + QUOTE_TTL_MS),
        },
      })
      return {
        quoteId: quote.id,
        expiresAt: quote.expiresAt.toISOString(),
        price: source.price.toFixed(2),
        offers: presentOffers(source.price, offers),
        selected: {
          installmentNumber: quote.installmentCount,
          installmentPrice: quote.installmentPrice.toFixed(2),
          totalPrice: quote.paidPrice.toFixed(2),
          differenceAmount: quote.paidPrice.sub(quote.price).toFixed(2),
        },
        card: {
          cardType: quote.cardType,
          cardAssociation: quote.cardAssociation,
          cardFamily: quote.cardFamily,
          bankName: quote.bankName,
        },
      }
    },

    /** Teklifin taksit/vade farkı bilgisiyle sözleşme önizlemesi. */
    async previewQuoteDocuments(userId: string, quoteId: string) {
      const quote = await prisma.cardPaymentQuote.findFirst({
        where: { id: quoteId, userId },
        include: {
          order: { select: { id: true, publicNumber: true, createdAt: true } },
        },
      })
      if (!quote || quote.expiresAt <= now()) {
        throw new DomainError(
          'Ödeme teklifinin süresi doldu; tutarı yenileyin.',
          'CARD_QUOTE_INVALID',
          409,
        )
      }
      return renderLegalDocuments(
        quoteContext(
          quote,
          quote.order
            ? {
                orderNumber: formatOrderNumber(quote.order.publicNumber, quote.order.id),
                orderDate: quote.order.createdAt,
              }
            : undefined,
        ),
      )
    },

    async startAttempt(params: {
      userId: string
      quoteId: string
      startKey: string
      card: IyzicoCard
      identityNumber?: string
      acceptance: LegalAcceptanceEvidence
      buyerIp: string
      callbackUrl: string
    }): Promise<StartAttemptResult> {
      if (!/^[A-Za-z0-9_-]{16,80}$/.test(params.startKey)) {
        throw new ValidationError('Geçersiz ödeme isteği')
      }
      const existing = await prisma.cardPaymentAttempt.findUnique({
        where: { startKey: params.startKey },
      })
      if (existing) {
        if (existing.userId !== params.userId || existing.quoteId !== params.quoteId) {
          throw new ConflictError('Ödeme isteği başka bir işleme ait')
        }
        return {
          kind: 'existing',
          attemptId: existing.id,
          orderId: existing.orderId,
          status: existing.status,
        }
      }

      const quote = await prisma.cardPaymentQuote.findFirst({
        where: { id: params.quoteId, userId: params.userId },
      })
      if (!quote || quote.consumedAt || quote.expiresAt <= now()) {
        throw new DomainError(
          'Ödeme tutarının süresi doldu veya kullanıldı; lütfen tutarı yenileyin.',
          'CARD_QUOTE_INVALID',
          409,
        )
      }
      if (
        quote.distanceSalesVersion !== DISTANCE_SALES_DOCUMENT_VERSION ||
        quote.preInformationVersion !== PRE_INFORMATION_DOCUMENT_VERSION
      ) {
        throw new DomainError(
          'Sözleşme metinleri güncellendi; lütfen yeniden onaylayın.',
          'CARD_QUOTE_INVALID',
          409,
        )
      }

      const pan = digitsOnly(params.card.cardNumber)
      if (!/^\d{15,19}$/.test(pan)) throw new ValidationError('Geçersiz kart numarası')
      if (pan.slice(0, 8) !== quote.binNumber) {
        throw new DomainError(
          'Kart numarası taksit hesaplanan kartla aynı değil; lütfen tutarı yenileyin.',
          'CARD_BIN_MISMATCH',
          422,
        )
      }

      let draft: Awaited<ReturnType<typeof checkout.buildDraft>> | null = null
      if (!quote.orderId) {
        draft = await checkout.buildDraft({
          userId: params.userId,
          addressId: quote.addressId,
          ...(quote.billingAddressId ? { billingAddressId: quote.billingAddressId } : {}),
          paymentMethod: 'card',
        })
        if (
          draftHash(draft, quote.addressId, quote.billingAddressId) !== quote.sourceHash ||
          !draft.totalAmount.eq(quote.price)
        ) {
          throw new DomainError(
            'Sepetiniz değişti. Lütfen tutarı kontrol edip yeniden onaylayın.',
            'CARD_CART_CHANGED',
            409,
          )
        }
      }

      // Oran ödeme başlamadan yeniden doğrulanır: müşteri gördüğünden farklı tutar onaylamaz.
      const limit = quote.orderId
        ? await installmentLimitForOrder(quote.orderId)
        : (draft?.installmentLimit ?? null)
      const { offers } = await fetchOffers(quote.binNumber, quote.price, limit)
      const current = offers.find((offer) => offer.installmentNumber === quote.installmentCount)
      if (!current || !new Decimal(current.totalPrice).eq(quote.paidPrice)) {
        throw new DomainError(
          'Taksit tutarı değişti. Lütfen güncel tutarı kontrol edip yeniden onaylayın.',
          'CARD_QUOTE_CHANGED',
          409,
          { offers: presentOffers(quote.price, offers) },
        )
      }

      // Fatura kimliği ödeme başlamadan doğrulanır (sipariş açılmadan önce).
      const billingAddressId = quote.billingAddressId ?? quote.addressId
      const billing = await prisma.address.findFirst({
        where: { id: billingAddressId, userId: params.userId },
      })
      if (!billing) throw new NotFoundError('Fatura adresi', billingAddressId)
      const identityNumber = resolveIdentityNumber(billing, params.identityNumber)

      let created: { attempt: CardPaymentAttempt; createdOrder: boolean; replay: boolean }
      try {
        created = await prisma.$transaction(async (tx) => {
          await lockQuoteRow(tx, quote.id)
          const lockedQuote = await tx.cardPaymentQuote.findUniqueOrThrow({
            where: { id: quote.id },
          })
          if (lockedQuote.consumedAt) {
            // Aynı istek (aynı startKey) eşzamanlı ikinci kez geldiyse ilk isteğin denemesi döner;
            // ikinci 3DS başlatılmaz.
            const sameRequest = await tx.cardPaymentAttempt.findUnique({
              where: { startKey: params.startKey },
            })
            if (
              sameRequest &&
              sameRequest.userId === params.userId &&
              sameRequest.quoteId === quote.id
            ) {
              return { attempt: sameRequest, createdOrder: false, replay: true }
            }
            throw new DomainError(
              'Bu ödeme tutarı zaten kullanıldı; lütfen sayfayı yenileyin.',
              'CARD_QUOTE_INVALID',
              409,
            )
          }

          let orderId: string
          let createdOrder = false
          if (!lockedQuote.orderId) {
            const { order } = await checkout.writeOrderRecords(
              tx,
              {
                userId: params.userId,
                addressId: lockedQuote.addressId,
                ...(lockedQuote.billingAddressId
                  ? { billingAddressId: lockedQuote.billingAddressId }
                  : {}),
                paymentMethod: 'card',
              },
              draft!,
            )
            orderId = order.id
            createdOrder = true
            await tx.order.update({
              where: { id: orderId },
              data: {
                cardPaymentExpiresAt: new Date(now().getTime() + CARD_PAYMENT_WINDOW_MS),
              },
            })
            await tx.cardPaymentQuote.update({
              where: { id: quote.id },
              data: { orderId },
            })
          } else {
            orderId = lockedQuote.orderId
            await lockOrderRow(tx, orderId)
            const order = await tx.order.findUniqueOrThrow({
              where: { id: orderId },
              include: { payments: true, cardPaymentAttempts: true },
            })
            if (order.customerId !== params.userId) throw new NotFoundError('Sipariş', orderId)
            assertOrderPayable(order)
            if (!order.totalAmount.eq(lockedQuote.price)) {
              throw new DomainError(
                'Sipariş tutarı değişti; lütfen yenileyin.',
                'CARD_QUOTE_INVALID',
                409,
              )
            }
            if (
              order.cardPaymentAttempts.some(
                (attempt) =>
                  (BLOCKING_STATUSES as readonly string[]).includes(attempt.status) ||
                  attempt.status === 'succeeded',
              )
            ) {
              throw new DomainError(
                'Ödemeniz kontrol ediliyor. Sonuç netleşmeden yeni ödeme başlatılamaz.',
                'CARD_ATTEMPT_BLOCKED',
                409,
              )
            }
            if (order.cardPaymentAttempts.length >= MAX_CARD_ATTEMPTS_PER_ORDER) {
              throw new DomainError(
                'Bu sipariş için deneme sınırına ulaşıldı. Lütfen sepetten yeni sipariş oluşturun.',
                'CARD_ATTEMPT_LIMIT',
                429,
              )
            }
            // Auth'a hiç geçmemiş eski deneme kapanır; eski callback auth çağıramaz.
            await tx.cardPaymentAttempt.updateMany({
              where: { orderId, status: { in: [...PRE_AUTH_STATUSES] } },
              data: { status: 'expired', completedAt: now() },
            })
          }

          const order = await tx.order.findUniqueOrThrow({
            where: { id: orderId },
            include: { payments: true },
          })
          const payment = order.payments.find((candidate) => candidate.method === 'card')
          if (!payment) throw new NotFoundError('Payment', orderId)

          const bundle = renderLegalDocuments(
            quoteContext(lockedQuote, {
              orderNumber: formatOrderNumber(order.publicNumber, order.id),
              orderDate: order.createdAt,
            }),
          )
          const attempt = await tx.cardPaymentAttempt.create({
            data: {
              orderId,
              paymentId: payment.id,
              quoteId: quote.id,
              startKey: params.startKey,
              userId: params.userId,
              conversationId: `hnj-${crypto.randomUUID()}`,
              installmentCount: lockedQuote.installmentCount,
              price: lockedQuote.price,
              paidPrice: lockedQuote.paidPrice,
              installmentDifferenceAmount: lockedQuote.paidPrice.sub(lockedQuote.price),
              binNumber: lockedQuote.binNumber,
              cardType: lockedQuote.cardType,
              cardAssociation: lockedQuote.cardAssociation,
              cardFamily: lockedQuote.cardFamily,
              bankName: lockedQuote.bankName,
              distanceSalesHtml: bundle.distanceSalesHtml,
              preInformationHtml: bundle.preInformationHtml,
              distanceSalesVersion: bundle.distanceSalesVersion,
              preInformationVersion: bundle.preInformationVersion,
              distanceSalesHash: hashLegalDocumentHtml(bundle.distanceSalesHtml),
              preInformationHash: hashLegalDocumentHtml(bundle.preInformationHtml),
              acceptedAt: params.acceptance.acceptedAt,
              acceptedIp: params.acceptance.ipAddress,
              acceptedUserAgent: params.acceptance.userAgent,
              acceptedSessionId: params.acceptance.sessionId,
            },
          })
          await tx.cardPaymentQuote.update({
            where: { id: quote.id },
            data: { consumedAt: now() },
          })
          return { attempt, createdOrder, replay: false }
        })
      } catch (error) {
        // Aynı startKey ile eşzamanlı ikinci istek: ilk isteğin denemesi döner.
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          const raced = await prisma.cardPaymentAttempt.findUnique({
            where: { startKey: params.startKey },
          })
          if (raced && raced.userId === params.userId) {
            return {
              kind: 'existing',
              attemptId: raced.id,
              orderId: raced.orderId,
              status: raced.status,
            }
          }
        }
        throw error
      }
      if (created.replay) {
        return {
          kind: 'existing',
          attemptId: created.attempt.id,
          orderId: created.attempt.orderId,
          status: created.attempt.status,
        }
      }
      if (created.createdOrder) await wakeStockSearchProjection()
      const attempt = created.attempt
      if (!attempt.paidPrice || !attempt.installmentCount)
        throw new ValidationError('Geçersiz doğrudan ödeme denemesi')

      const order = await prisma.order.findUniqueOrThrow({
        where: { id: attempt.orderId },
        include: {
          lines: { include: { product: { include: { category: true } } } },
          address: true,
          billingAddress: true,
          customer: true,
          payments: { include: { providerItems: true } },
        },
      })
      const payment = order.payments.find((candidate) => candidate.id === attempt.paymentId)!
      const basket = buildCardBasket({
        orderId: order.id,
        lines: order.lines.map((line) => ({
          orderLineId: line.id,
          amount: line.customerPaidProductAmount ?? line.totalPrice,
        })),
        shippingAmount: order.shippingAmount,
        price: attempt.price,
      })
      const expectedIds = new Set(payment.providerItems.map((item) => item.providerItemId))
      if (
        !basket ||
        basket.length !== expectedIds.size ||
        basket.some((item) => !expectedIds.has(item.providerItemId)) ||
        !order.address
      ) {
        await transitionAttempt(attempt.id, ['initialized'], {
          status: 'failed',
          errorCode: 'BASKET_MISMATCH',
          completedAt: now(),
        })
        await appendEvent(prisma, payment.id, 'card_basket_mismatch', {
          attemptId: attempt.id,
        })
        throw new DomainError(
          'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
          'CARD_PAYMENT_START_FAILED',
          500,
        )
      }

      const linesById = new Map(order.lines.map((line) => [line.id, line]))
      const shippingAddress = order.address
      const billingAddress = order.billingAddress ?? order.address
      const formatAddress = (address: typeof shippingAddress) =>
        [address.addressLine1, address.addressLine2, address.district, address.city]
          .filter((part) => part && part.trim())
          .join(', ')
      const buyerName = splitFullName(billingAddress.fullName)
      const gsmNumber =
        normalizeTurkishGsm(billingAddress.phone) ?? normalizeTurkishGsm(shippingAddress.phone)

      const outcome = await gateway.initiate3DS({
        conversationId: attempt.conversationId,
        basketId: order.id,
        price: toIyzicoPrice(attempt.price),
        paidPrice: toIyzicoPrice(attempt.paidPrice),
        installment: attempt.installmentCount,
        callbackUrl: params.callbackUrl,
        buyer: {
          id: order.customerId,
          name: buyerName.name,
          surname: buyerName.surname,
          email: order.customer.email,
          identityNumber,
          registrationAddress: formatAddress(billingAddress),
          city: billingAddress.city,
          country: 'Turkey',
          ip: params.buyerIp,
          ...(gsmNumber ? { gsmNumber } : {}),
          ...(billingAddress.postalCode ? { zipCode: billingAddress.postalCode } : {}),
        },
        shippingAddress: {
          contactName: shippingAddress.fullName,
          city: shippingAddress.city,
          country: 'Turkey',
          address: formatAddress(shippingAddress),
          ...(shippingAddress.postalCode ? { zipCode: shippingAddress.postalCode } : {}),
        },
        billingAddress: {
          contactName: billingAddress.fullName,
          city: billingAddress.city,
          country: 'Turkey',
          address: formatAddress(billingAddress),
          ...(billingAddress.postalCode ? { zipCode: billingAddress.postalCode } : {}),
        },
        basketItems: basket.map((item) => {
          const line = item.orderLineId ? linesById.get(item.orderLineId) : null
          return {
            id: item.providerItemId,
            name: line ? line.productName.slice(0, 100) : 'Kargo',
            category1: line ? (line.product.category?.name ?? 'Ev ve Yaşam') : 'Kargo',
            itemType: line ? ('PHYSICAL' as const) : ('VIRTUAL' as const),
            price: toIyzicoPrice(item.amount),
          }
        }),
        paymentCard: {
          cardHolderName: params.card.cardHolderName,
          cardNumber: pan,
          expireMonth: params.card.expireMonth,
          expireYear: params.card.expireYear,
          cvc: params.card.cvc,
        },
      })

      if (outcome.kind !== 'success') {
        const errorCode = outcome.kind === 'failure' ? (outcome.errorCode ?? null) : 'UNKNOWN'
        const errorMessage = outcome.kind === 'failure' ? outcome.errorMessage : outcome.reason
        await transitionAttempt(attempt.id, ['initialized'], {
          status: 'failed',
          errorCode,
          errorMessage: errorMessage.slice(0, 500),
          completedAt: now(),
        })
        await appendEvent(prisma, payment.id, 'card_threeds_initialize_failed', {
          attemptId: attempt.id,
          errorCode,
        })
        throw new DomainError(
          outcome.kind === 'failure' && outcome.errorCode !== 'SIGNATURE_MISMATCH'
            ? `Ödeme başlatılamadı: ${errorMessage}`
            : 'Ödeme başlatılamadı. Lütfen tekrar deneyin.',
          'CARD_PAYMENT_START_FAILED',
          422,
          { orderId: order.id },
        )
      }

      const moved = await transitionAttempt(attempt.id, ['initialized'], {
        status: 'threeds_pending',
        providerPaymentId: outcome.data.paymentId,
      })
      if (!moved) {
        throw new DomainError(
          'Ödeme süresi doldu; lütfen yeniden deneyin.',
          'CARD_ORDER_NOT_PAYABLE',
          409,
        )
      }
      await appendEvent(prisma, payment.id, 'card_threeds_initialized', {
        attemptId: attempt.id,
        providerPaymentId: outcome.data.paymentId,
        installmentCount: attempt.installmentCount,
      })
      return {
        kind: 'threeds',
        attemptId: attempt.id,
        orderId: order.id,
        html: outcome.data.htmlContent,
      }
    },

    /** iyzico 3DS callback'i. Callback'teki hiçbir değer tek başına başarı sayılmaz. */
    async handleCallback(
      fields: CallbackFields,
    ): Promise<{ orderId: string | null; outcome: CallbackOutcome }> {
      const attempt = fields.conversationId
        ? await prisma.cardPaymentAttempt.findUnique({
            where: { conversationId: fields.conversationId },
          })
        : null
      if (!attempt) return { orderId: null, outcome: 'invalid' }

      const signature = verifyCallbackSignature(fields)
      // Başarısız 3DS dönüşünde iyzico paymentId göndermez (sandbox, 2026-10-17); imzası geçerli bir
      // başarısızlık bildirimi bu yüzden paymentId olmadan da kabul edilir. Başarı için eşleşme şarttır.
      const paymentIdAccepted = fields.paymentId
        ? fields.paymentId === attempt.providerPaymentId
        : fields.status !== 'success' && signature === 'valid'
      if (signature === 'invalid' || !paymentIdAccepted) {
        await appendEvent(prisma, attempt.paymentId, 'card_callback_rejected', {
          attemptId: attempt.id,
          signature,
          paymentIdMatches: fields.paymentId === attempt.providerPaymentId,
          receivedPaymentId: fields.paymentId ?? null,
          status: fields.status ?? null,
          mdStatus: fields.mdStatus ?? null,
        })
        return { orderId: attempt.orderId, outcome: 'invalid' }
      }

      // iyzico'nun callback'te imza gönderip göndermediği canlıya geçiş kararı için izlenir.
      await appendEvent(prisma, attempt.paymentId, 'card_callback_received', {
        attemptId: attempt.id,
        signature,
        status: fields.status ?? null,
        mdStatus: fields.mdStatus ?? null,
      })

      if (attempt.status !== 'threeds_pending') {
        return {
          orderId: attempt.orderId,
          outcome: outcomeForStatus(attempt.status),
        }
      }

      if (fields.status !== 'success' || fields.mdStatus !== '1') {
        await transitionAttempt(attempt.id, ['threeds_pending'], {
          status: 'failed',
          mdStatus: fields.mdStatus,
          errorCode: '3DS_NOT_VERIFIED',
          completedAt: now(),
        })
        await appendEvent(prisma, attempt.paymentId, 'card_threeds_failed', {
          attemptId: attempt.id,
          mdStatus: fields.mdStatus,
          status: fields.status,
        })
        return { orderId: attempt.orderId, outcome: 'failed' }
      }

      const decision = await prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, attempt.orderId)
        const fresh = await tx.cardPaymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
        if (fresh.status !== 'threeds_pending') return fresh.status
        const order = await tx.order.findUniqueOrThrow({
          where: { id: attempt.orderId },
        })
        if (
          order.status !== 'payment_pending' ||
          !order.cardPaymentExpiresAt ||
          order.cardPaymentExpiresAt <= now()
        ) {
          await tx.cardPaymentAttempt.update({
            where: { id: attempt.id },
            data: {
              status: 'expired',
              mdStatus: fields.mdStatus,
              completedAt: now(),
            },
          })
          return 'expired' as const
        }
        await tx.cardPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'authorizing',
            authRequestedAt: now(),
            mdStatus: fields.mdStatus,
          },
        })
        return 'go' as const
      })
      if (decision !== 'go') {
        return {
          orderId: attempt.orderId,
          outcome: outcomeForStatus(decision),
        }
      }

      const authorizing = await prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      })
      if (attempt.flow !== 'direct_3ds' || !attempt.paidPrice)
        return { orderId: attempt.orderId, outcome: 'invalid' }
      const outcome = await gateway.complete3DS({
        paymentId: attempt.providerPaymentId!,
        conversationId: attempt.conversationId,
        basketId: attempt.orderId,
        paidPrice: toIyzicoPrice(attempt.paidPrice),
      })
      return {
        orderId: attempt.orderId,
        outcome: await applyAuthOutcome(authorizing, outcome),
      }
    },

    async getAttemptState(userId: string, startKey: string) {
      const attempt = await prisma.cardPaymentAttempt.findUnique({
        where: { startKey },
      })
      if (!attempt || attempt.userId !== userId) return null
      if (
        attempt.flow === 'checkout_form' &&
        ['checkout_form_pending', 'outcome_unknown', 'fraud_review'].includes(attempt.status)
      ) {
        await checkoutForm.reconcile(attempt.id)
        const current = await prisma.cardPaymentAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        })
        return {
          attemptId: current.id,
          orderId: current.orderId,
          status: current.status,
          outcome: outcomeForStatus(current.status),
          sourceHash: current.sourceHash,
          startKey: current.startKey,
          superseded: !!current.supersededAt,
          ...(current.status === 'checkout_form_pending' &&
          !current.supersededAt &&
          current.checkoutFormExpiresAt &&
          current.checkoutFormExpiresAt > now()
            ? {
                iframeUrl: current.checkoutFormUrl,
                expiresAt: current.checkoutFormExpiresAt.toISOString(),
              }
            : {}),
        }
      }
      return {
        attemptId: attempt.id,
        orderId: attempt.orderId,
        status: attempt.status,
        outcome: outcomeForStatus(attempt.status),
        ...(attempt.flow === 'checkout_form'
          ? { sourceHash: attempt.sourceHash, superseded: !!attempt.supersededAt }
          : {}),
      }
    },

    /** /odeme?siparis= ve sipariş sayfası için: siparişin kartla yeniden ödenebilirliği. */
    async getOrderPaymentState(userId: string, orderId: string) {
      const order = await prisma.order.findFirst({
        where: { id: orderId, customerId: userId },
        include: {
          payments: true,
          cardPaymentAttempts: { orderBy: { createdAt: 'desc' } },
        },
      })
      if (!order) return null
      const checking = order.cardPaymentAttempts.some((attempt) =>
        (BLOCKING_STATUSES as readonly string[]).includes(attempt.status),
      )
      const cardPayment = order.payments.find((payment) => payment.method === 'card')
      const currentForm = order.cardPaymentAttempts.find(
        (attempt) => !attempt.supersededAt && attempt.flow === 'checkout_form' &&
          attempt.status === 'checkout_form_pending',
      )
      const formExpired = !!currentForm && (!currentForm.checkoutFormExpiresAt ||
        currentForm.checkoutFormExpiresAt <= now())
      const payable =
        order.status === 'payment_pending' &&
        cardPayment?.status === 'pending' &&
        !!order.cardPaymentExpiresAt &&
        order.cardPaymentExpiresAt > now() &&
        !formExpired &&
        !checking &&
        (order.cardPaymentAttempts.length < MAX_CARD_ATTEMPTS_PER_ORDER ||
          order.cardPaymentAttempts.some(
            (attempt) =>
              attempt.flow === 'checkout_form' &&
              !attempt.supersededAt &&
              attempt.status === 'checkout_form_pending' &&
              attempt.checkoutFormExpiresAt &&
              attempt.checkoutFormExpiresAt > now(),
          ))
      return {
        orderId: order.id,
        status: order.status,
        confirmed: !!order.paymentConfirmedAt || order.payments.some((payment) => !!payment.confirmedAt),
        attemptId: order.cardPaymentAttempts[0]?.id ?? null,
        attemptStatus: order.cardPaymentAttempts[0]?.status ?? null,
        payable,
        checking,
        expiresAt: order.cardPaymentExpiresAt?.toISOString() ?? null,
        totalAmount: order.totalAmount.toFixed(2),
        grossAmount: order.grossAmount.toFixed(2),
        couponDiscountAmount: order.discountAmount.toFixed(2),
        shippingAmount: order.shippingAmount.toFixed(2),
        attemptsLeft: Math.max(0, MAX_CARD_ATTEMPTS_PER_ORDER - order.cardPaymentAttempts.length),
      }
    },

    processCapturedPayment,
    reconcileAttempt,
    processReversal,
    reconcileReversal,
    expireOrder,

    processWebhookEvent,

    /** Worker: süresi dolan siparişler, belirsiz denemeler, yarım geri ödemeler, işlenmemiş webhook'lar. */
    async runMaintenance(limit = 50) {
      await prisma.checkoutFormPreview.deleteMany({
        where: { expiresAt: { lt: new Date(now().getTime() - 7 * 86400_000) } },
      })
      await prisma.checkoutFormPreview.deleteMany({
        where: { expiresAt: { lt: new Date(now().getTime() - 7 * 86400_000) } },
      })
      const summary = {
        expired: 0,
        blocked: 0,
        reconciled: 0,
        reversals: 0,
        webhooks: 0,
      }
      const dueOrders = await prisma.order.findMany({
        where: {
          status: 'payment_pending',
          cardPaymentExpiresAt: { lte: now() },
        },
        select: { id: true },
        take: limit,
      })
      for (const order of dueOrders) {
        const forms = await prisma.cardPaymentAttempt.findMany({
          where: {
            orderId: order.id,
            flow: 'checkout_form',
            checkoutFormToken: { not: null },
            status: { in: ['checkout_form_pending', 'outcome_unknown', 'fraud_review'] },
          },
          select: { id: true },
        })
        for (const form of forms) await checkoutForm.reconcile(form.id)
        const result = await expireOrder(order.id)
        if (result === 'cancelled') summary.expired += 1
        if (result === 'blocked') summary.blocked += 1
      }

      const openAttempts = await prisma.cardPaymentAttempt.findMany({
        where: {
          OR: [
            { status: { in: [...BLOCKING_STATUSES] } },
            {
              flow: 'checkout_form',
              checkoutFormToken: { not: null },
              status: { in: ['checkout_form_pending', 'expired', 'failed'] },
              updatedAt: { lt: new Date(now().getTime() - 30_000) },
              createdAt: { gt: new Date(now().getTime() - 7 * 86400_000) },
            },
          ],
        },
        select: { id: true },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      })
      for (const attempt of openAttempts) {
        if ((await reconcileAttempt(attempt.id)) !== null) summary.reconciled += 1
      }

      const reversals = await prisma.cardAttemptReversal.findMany({
        where: { status: { in: ['pending', 'uncertain', 'processing'] } },
        orderBy: { updatedAt: 'asc' },
        take: limit,
      })
      for (const reversal of reversals) {
        if (reversal.status === 'pending') await processReversal(reversal.id)
        else if (
          reversal.status === 'uncertain' ||
          now().getTime() - (reversal.lastAttemptAt ?? reversal.updatedAt).getTime() >=
            AUTH_NOT_COMPLETED_AFTER_MS
        ) {
          // Uzun süre "processing"te kalan iş (süreç kapandı) belirsiz sayılır, rapordan doğrulanır.
          if (reversal.status === 'processing') {
            await prisma.cardAttemptReversal.updateMany({
              where: { id: reversal.id, status: 'processing' },
              data: { status: 'uncertain' },
            })
          }
          await reconcileReversal(reversal.id)
        }
        summary.reversals += 1
      }

      const events = await prisma.iyzicoWebhookEvent.findMany({
        where: { processedAt: null, attempts: { lt: 10 } },
        orderBy: { receivedAt: 'asc' },
        take: limit,
        select: { id: true },
      })
      for (const event of events) {
        await processWebhookEvent(event.id).catch(() => undefined)
        summary.webhooks += 1
      }
      return summary
    },
  }
}

export type CardPaymentService = ReturnType<typeof createCardPaymentService>
