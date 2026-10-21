import crypto from 'node:crypto'
import { Prisma, type PrismaClient, type CardPaymentAttempt } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import * as iyzico from '../lib/iyzico'
import { DomainError, NotFoundError } from '../lib/errors'
import {
  hashLegalDocumentHtml,
  renderLegalDocuments,
  type LegalContractContext,
  type LegalDocumentBundle,
  DISTANCE_SALES_DOCUMENT_VERSION,
  PRE_INFORMATION_DOCUMENT_VERSION,
} from '../lib/legal-documents'
import type { LegalAcceptanceEvidence } from '../lib/legal-acceptance'
import { createCheckoutService } from './checkout.service'
import {
  basketInstallmentLimit,
  checkoutFormInstallments,
  resolveCategoryInstallmentLimit,
} from '../domain/card-installments'
import { lockOrderRow, normalizeTurkishGsm, splitFullName } from './card-payment-support'
import { wakeStockSearchProjection } from './product-stock-sync'
import type { CallbackOutcome } from './card-payment.service'
import { checkoutSourceFingerprint, matchesCheckoutSource } from './checkout-source-fingerprint'

export type CheckoutFormGateway = Pick<
  typeof iyzico,
  'initializeCheckoutForm' | 'retrieveCheckoutForm' | 'retrievePayment' | 'getPaymentReport'
>
export const CHECKOUT_FORM_FLOW = 'checkout_form'
const WINDOW_MS = 30 * 60_000
const terminal = ['succeeded', 'voided', 'refunded', 'refunded_by_provider']

function contextOf(json: Prisma.JsonValue): LegalContractContext {
  const context = json as unknown as LegalContractContext
  return { ...context, orderDate: new Date(context.orderDate) }
}

export function checkoutSourceHash(
  draft: Awaited<ReturnType<ReturnType<typeof createCheckoutService>['buildDraft']>>,
  addressId: string,
  billingAddressId: string | null,
) {
  return crypto
    .createHash('sha256')
    .update(
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
        // Address/billing edits must invalidate consent even if their IDs stay unchanged.
        buyer: draft.legalContext.buyer,
        items: draft.legalContext.items,
        sellers: draft.legalContext.sellers,
      }),
    )
    .digest('hex')
}

export function createCheckoutFormService({
  prisma,
  gateway = iyzico,
  now = () => new Date(),
  processCapturedPayment,
  expireOrder,
}: {
  prisma: PrismaClient
  gateway?: CheckoutFormGateway
  now?: () => Date
  processCapturedPayment: (
    attemptId: string,
    detail: iyzico.IyzicoPaymentDetail,
  ) => Promise<CallbackOutcome>
  expireOrder: (orderId: string) => Promise<unknown>
}) {
  const checkout = createCheckoutService({ prisma })

  async function preview(params: {
    userId: string
    addressId?: string
    billingAddressId?: string
    orderId?: string
  }) {
    if (params.orderId) {
      const active = await prisma.cardPaymentAttempt.findFirst({
        where: {
          orderId: params.orderId,
          userId: params.userId,
          flow: CHECKOUT_FORM_FLOW,
          supersededAt: null,
          status: 'checkout_form_pending',
          checkoutFormExpiresAt: { gt: now() },
        },
        orderBy: { createdAt: 'desc' },
        include: { order: { include: { cardPaymentAttempts: true } } },
      })
      if (active && (await matchesCheckoutSource(prisma, active.order)) === false)
        throw new DomainError('Sepet veya adres değişti; önceki ödeme oturumunu kapatın.',
          'CHECKOUT_FORM_CONTEXT_CHANGED', 409, { attemptId: active.id })
      if (active?.legalContext && active.checkoutFormPreviewId)
        return {
          ...(active.legalSnapshots as unknown as Pick<
            LegalDocumentBundle,
            'buyerSnapshot' | 'sellerSnapshot' | 'platformSnapshot'
          >),
          distanceSalesHtml: active.distanceSalesHtml,
          preInformationHtml: active.preInformationHtml,
          distanceSalesVersion: active.distanceSalesVersion,
          preInformationVersion: active.preInformationVersion,
          previewId: active.checkoutFormPreviewId,
          sourceHash: active.sourceHash!,
        }
    }
    const fingerprint = await checkoutSourceFingerprint(prisma, params)
    // Recover the frozen reservation before revalidating coupons/available stock: this order
    // already owns those resources. A reload must not count its coupon as a second use.
    if (!params.orderId) {
      const pending = await prisma.cardPaymentAttempt.findFirst({
        where: {
          userId: params.userId,
          flow: CHECKOUT_FORM_FLOW,
          supersededAt: null,
          status: 'checkout_form_pending',
          checkoutFormExpiresAt: { gt: now() },
        },
        orderBy: { createdAt: 'desc' },
      })
      if (
        pending?.legalContext &&
        pending.checkoutFormPreviewId &&
        contextOf(pending.legalContext).checkoutSourceFingerprint === fingerprint
      ) {
        return {
          ...(pending.legalSnapshots as unknown as Pick<
            LegalDocumentBundle,
            'buyerSnapshot' | 'sellerSnapshot' | 'platformSnapshot'
          >),
          distanceSalesHtml: pending.distanceSalesHtml,
          preInformationHtml: pending.preInformationHtml,
          distanceSalesVersion: pending.distanceSalesVersion,
          preInformationVersion: pending.preInformationVersion,
          previewId: pending.checkoutFormPreviewId,
          sourceHash: pending.sourceHash!,
        }
      }
      if (pending)
        throw new DomainError(
          'Sepet veya adres değişti; önceki ödeme oturumunu kapatın.',
          'CHECKOUT_FORM_CONTEXT_CHANGED',
          409,
          { attemptId: pending.id },
        )
    }
    let context: LegalContractContext
    let addressId: string
    let billingAddressId: string | null
    let sourceHash: string
    if (params.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: params.orderId, customerId: params.userId },
        include: {
          cardPaymentAttempts: { orderBy: { createdAt: 'desc' } },
          cardPaymentQuotes: { orderBy: { createdAt: 'asc' }, take: 1 },
        },
      })
      if (
        !order?.addressId ||
        order.status !== 'payment_pending' ||
        !order.cardPaymentExpiresAt ||
        order.cardPaymentExpiresAt <= now()
      )
        throw new DomainError('Sipariş ödemeye açık değil.', 'CARD_ORDER_NOT_PAYABLE', 409)
      if ((await matchesCheckoutSource(prisma, order)) === false)
        throw new DomainError('Sepet veya adres değişti; önceki ödeme oturumunu kapatın.',
          'CHECKOUT_FORM_CONTEXT_CHANGED', 409, { attemptId: order.cardPaymentAttempts[0]?.id })
      const json =
        order.cardPaymentAttempts[0]?.legalContext ?? order.cardPaymentQuotes[0]?.legalContext
      if (!json)
        throw new DomainError('Sipariş sözleşmesi bulunamadı.', 'CARD_ORDER_NOT_PAYABLE', 409)
      context = contextOf(json)
      addressId = order.addressId
      billingAddressId = order.billingAddressId
      sourceHash = crypto
        .createHash('sha256')
        .update(`order:${order.id}:${order.totalAmount.toFixed(2)}`)
        .digest('hex')
    } else {
      if (!params.addressId)
        throw new DomainError('Teslimat adresi seçin.', 'ADDRESS_REQUIRED', 422)
      const draft = await checkout.buildDraft({
        ...params,
        addressId: params.addressId,
        paymentMethod: 'card',
      })
      context = draft.legalContext
      addressId = params.addressId
      billingAddressId = params.billingAddressId ?? null
      sourceHash = checkoutSourceHash(draft, addressId, billingAddressId)
    }
    context = {
      ...context,
      cardPaymentFlow: CHECKOUT_FORM_FLOW,
      checkoutSourceFingerprint: fingerprint,
      installmentCount: null,
      installmentDifferenceAmount: null,
    }
    const active = await prisma.cardPaymentAttempt.findFirst({
      where: {
        userId: params.userId,
        flow: CHECKOUT_FORM_FLOW,
        sourceHash,
        supersededAt: null,
        status: 'checkout_form_pending',
        checkoutFormExpiresAt: { gt: now() },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (active?.checkoutFormPreviewId && active.legalContext)
      return {
        ...(active.legalSnapshots as unknown as Pick<
          LegalDocumentBundle,
          'buyerSnapshot' | 'sellerSnapshot' | 'platformSnapshot'
        >),
        distanceSalesHtml: active.distanceSalesHtml,
        preInformationHtml: active.preInformationHtml,
        distanceSalesVersion: active.distanceSalesVersion,
        preInformationVersion: active.preInformationVersion,
        previewId: active.checkoutFormPreviewId,
        sourceHash,
      }
    const bundle = renderLegalDocuments(context)
    const record = await prisma.checkoutFormPreview.create({
      data: {
        userId: params.userId,
        orderId: params.orderId ?? null,
        addressId,
        billingAddressId,
        sourceHash,
        legalContext: context as unknown as Prisma.InputJsonValue,
        documents: bundle as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(now().getTime() + WINDOW_MS),
      },
    })
    return { ...bundle, previewId: record.id, sourceHash }
  }

  function present(attempt: CardPaymentAttempt) {
    if (
      attempt.supersededAt ||
      attempt.status !== 'checkout_form_pending' ||
      !attempt.checkoutFormUrl ||
      !attempt.checkoutFormExpiresAt ||
      attempt.checkoutFormExpiresAt <= now()
    ) {
      throw new DomainError(
        'Ödeme oturumu hazır değil veya sona erdi. Sipariş durumunu kontrol edin.',
        'CHECKOUT_FORM_NOT_READY',
        409,
        { orderId: attempt.orderId, status: attempt.status },
      )
    }
    return {
      orderId: attempt.orderId,
      attemptId: attempt.id,
      iframeUrl: attempt.checkoutFormUrl,
      expiresAt: attempt.checkoutFormExpiresAt.toISOString(),
      startKey: attempt.startKey,
    }
  }

  async function reuse(userId: string, previewId: string, startKey: string) {
    const [consent, attempt] = await Promise.all([
      prisma.checkoutFormPreview.findFirst({ where: { id: previewId, userId } }),
      prisma.cardPaymentAttempt.findUnique({ where: { startKey } }),
    ])
    if (
      !consent ||
      !attempt ||
      attempt.userId !== userId ||
      attempt.flow !== CHECKOUT_FORM_FLOW ||
      attempt.sourceHash !== consent.sourceHash ||
      attempt.supersededAt ||
      attempt.status !== 'checkout_form_pending' ||
      !attempt.checkoutFormExpiresAt ||
      attempt.checkoutFormExpiresAt <= now()
    )
      return null
    return present(attempt)
  }

  async function start(params: {
    userId: string
    previewId: string
    startKey: string
    identityNumber?: string
    acceptance: LegalAcceptanceEvidence
    buyerIp: string
    callbackUrl: string
  }) {
    const consent = await prisma.checkoutFormPreview.findFirst({
      where: { id: params.previewId, userId: params.userId },
    })
    if (!consent) throw new NotFoundError('Sözleşme önizlemesi', params.previewId)
    const existing = await prisma.cardPaymentAttempt.findUnique({
      where: { startKey: params.startKey },
    })
    if (existing) {
      if (
        existing.userId !== params.userId ||
        existing.flow !== CHECKOUT_FORM_FLOW ||
        existing.sourceHash !== consent.sourceHash
      )
        throw new DomainError('Ödeme isteği başka bir işleme ait.', 'CHECKOUT_FORM_CONFLICT', 409)
      return present(existing)
    }
    if (consent.expiresAt <= now())
      throw new DomainError(
        'Sözleşmelerin süresi doldu; yeniden onaylayın.',
        'CHECKOUT_FORM_PREVIEW_EXPIRED',
        409,
      )
    const previous = await prisma.cardPaymentAttempt.findUnique({
      where: { checkoutFormPreviewId: consent.id },
    })
    if (previous && previous.userId === params.userId && previous.flow === CHECKOUT_FORM_FLOW)
      return present(previous)
    const bundle = consent.documents as unknown as LegalDocumentBundle | null
    if (
      !bundle ||
      bundle.distanceSalesVersion !== DISTANCE_SALES_DOCUMENT_VERSION ||
      bundle.preInformationVersion !== PRE_INFORMATION_DOCUMENT_VERSION
    ) {
      throw new DomainError(
        'Sözleşmeler güncellendi. Lütfen yeniden görüntüleyip onaylayın.',
        'CHECKOUT_FORM_PREVIEW_EXPIRED',
        409,
      )
    }
    const billing = await prisma.address.findFirst({
      where: { id: consent.billingAddressId ?? consent.addressId, userId: params.userId },
    })
    if (!billing) throw new NotFoundError('Fatura adresi', consent.addressId)
    // iyzico buyer identity is separate from optional customer invoice information.
    // The unspecified identity fallback is sent only to the provider, never saved as a customer's TC.
    const invoiceIdentity =
      billing.invoiceType === 'corporate'
        ? billing.taxNumber?.trim()
        : billing.tcNumber?.trim() || params.identityNumber?.trim()
    const identityNumber = /^\d{10,11}$/.test(invoiceIdentity ?? '')
      ? invoiceIdentity!
      : '11111111111'

    const created = await prisma.$transaction(
      async (tx) => {
        // Serialize all checkout starts for this customer, including different keys/tabs.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cf:${params.userId}`}))`
        const replay = await tx.cardPaymentAttempt.findFirst({
          where: { OR: [{ startKey: params.startKey }, { checkoutFormPreviewId: consent.id }] },
        })
        if (replay) {
          if (replay.userId !== params.userId || replay.sourceHash !== consent.sourceHash)
            throw new DomainError(
              'Ödeme isteği başka bir işleme ait.',
              'CHECKOUT_FORM_CONFLICT',
              409,
            )
          return { attempt: replay, replay: true }
        }
        const unresolved = await tx.cardPaymentAttempt.findFirst({
          where: { userId: params.userId, supersededAt: null,
            status: { in: ['authorizing', 'outcome_unknown', 'fraud_review'] } },
        })
        if (unresolved)
          throw new DomainError('Ödeme sonucu kontrol ediliyor. Sonuç netleşmeden yeni ödeme başlatılamaz.',
            'CARD_PAYMENT_CHECKING', 409, { orderId: unresolved.orderId })
        let orderId = consent.orderId
        let limit: number | null
        if (!orderId) {
          const draft = await checkout.buildDraft({
            userId: params.userId,
            addressId: consent.addressId,
            ...(consent.billingAddressId ? { billingAddressId: consent.billingAddressId } : {}),
            paymentMethod: 'card',
          })
          if (
            checkoutSourceHash(draft, consent.addressId, consent.billingAddressId) !==
            consent.sourceHash
          )
            throw new DomainError(
              'Sepet veya adres bilgileri değişti. Sözleşmeleri yeniden onaylayın.',
              'CARD_CART_CHANGED',
              409,
            )
          // A second tab must recover the same active intent, not reserve the basket twice.
          const active = await tx.cardPaymentAttempt.findFirst({
            where: {
              userId: params.userId,
              flow: CHECKOUT_FORM_FLOW,
              sourceHash: consent.sourceHash,
              supersededAt: null,
              status: {
                in: ['initialized', 'checkout_form_pending', 'outcome_unknown', 'fraud_review'],
              },
            },
            orderBy: { createdAt: 'desc' },
          })
          if (active) return { attempt: active, replay: true }
          const result = await checkout.writeOrderRecords(
            tx,
            {
              userId: params.userId,
              addressId: consent.addressId,
              ...(consent.billingAddressId ? { billingAddressId: consent.billingAddressId } : {}),
              paymentMethod: 'card',
            },
            draft,
          )
          orderId = result.order.id
          limit = draft.installmentLimit
          await tx.order.update({
            where: { id: orderId },
            data: { cardPaymentExpiresAt: new Date(now().getTime() + WINDOW_MS) },
          })
        } else {
          await lockOrderRow(tx, orderId)
          const order = await tx.order.findFirst({
            where: { id: orderId, customerId: params.userId },
            include: {
              cardPaymentAttempts: true,
              lines: { include: { product: { select: { categoryId: true } } } },
            },
          })
          if (
            !order ||
            order.status !== 'payment_pending' ||
            !order.cardPaymentExpiresAt ||
            order.cardPaymentExpiresAt <= now()
          )
            throw new DomainError('Sipariş ödemeye açık değil.', 'CARD_ORDER_NOT_PAYABLE', 409)
          if ((await matchesCheckoutSource(tx, order)) === false)
            throw new DomainError('Sepet veya adres değişti; önceki ödeme oturumunu kapatın.',
              'CHECKOUT_FORM_CONTEXT_CHANGED', 409, { attemptId: order.cardPaymentAttempts[0]?.id })
          const active = order.cardPaymentAttempts.find(
            (a) =>
              !a.supersededAt &&
              [
                'initialized',
                'checkout_form_pending',
                'authorizing',
                'outcome_unknown',
                'fraud_review',
                'succeeded',
              ].includes(a.status),
          )
          if (active) return { attempt: active, replay: true }
          if (order.cardPaymentAttempts.length >= 5)
            throw new DomainError('Ödeme deneme sınırına ulaşıldı.', 'CARD_ATTEMPT_LIMIT', 429)
          await tx.cardPaymentAttempt.updateMany({
            where: {
              orderId,
              flow: 'direct_3ds',
              status: { in: ['initialized', 'threeds_pending'] },
            },
            data: { status: 'expired', completedAt: now() },
          })
          await tx.cardPaymentAttempt.updateMany({
            where: { orderId, flow: CHECKOUT_FORM_FLOW, status: { in: ['failed', 'expired'] } },
            data: { supersededAt: now() },
          })
          const categories = await tx.category.findMany({
            select: { id: true, parentId: true, maxInstallmentCount: true },
          })
          const map = new Map(categories.map((c) => [c.id, c]))
          limit = basketInstallmentLimit(
            order.lines.map((l) => resolveCategoryInstallmentLimit(l.product.categoryId, map)),
          )
        }
        const payment = await tx.payment.findFirstOrThrow({
          where: { orderId, method: 'card', status: 'pending' },
        })
        const allowedInstallments = checkoutFormInstallments(limit)
        const attempt = await tx.cardPaymentAttempt.create({
          data: {
            orderId,
            paymentId: payment.id,
            userId: params.userId,
            flow: CHECKOUT_FORM_FLOW,
            startKey: params.startKey,
            checkoutFormPreviewId: consent.id,
            sourceHash: consent.sourceHash,
            legalContext: consent.legalContext as Prisma.InputJsonValue,
            legalSnapshots: {
              buyerSnapshot: bundle.buyerSnapshot,
              sellerSnapshot: bundle.sellerSnapshot,
              platformSnapshot: bundle.platformSnapshot,
            } as unknown as Prisma.InputJsonValue,
            conversationId: `hnj-cf-${crypto.randomUUID()}`,
            price: payment.amount,
            allowedInstallments,
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
        return { attempt, replay: false }
      },
      { timeout: 20_000 },
    )
    if (created.replay) return present(created.attempt)
    await wakeStockSearchProjection()
    const attempt = created.attempt
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: attempt.orderId },
      include: {
        customer: true,
        address: true,
        billingAddress: true,
        payments: { include: { providerItems: { include: { orderLine: true } } } },
      },
    })
    if (!order.address)
      throw new DomainError('Teslimat adresi bulunamadı.', 'ADDRESS_REQUIRED', 422)
    const shipping = order.address
    const invoice = order.billingAddress ?? shipping
    const address = (a: typeof shipping) => ({
      contactName: a.fullName,
      city: a.city,
      country: 'Turkey',
      address: [a.addressLine1, a.addressLine2, a.district, a.city].filter(Boolean).join(', '),
      ...(a.postalCode ? { zipCode: a.postalCode } : {}),
    })
    const name = splitFullName(invoice.fullName)
    const gsmNumber = normalizeTurkishGsm(invoice.phone) ?? normalizeTurkishGsm(shipping.phone)
    const payment = order.payments.find((p) => p.id === attempt.paymentId)!
    const outcome = await gateway.initializeCheckoutForm({
      conversationId: attempt.conversationId,
      basketId: order.id,
      price: iyzico.toIyzicoPrice(attempt.price),
      paidPrice: iyzico.toIyzicoPrice(attempt.price),
      enabledInstallments: attempt.allowedInstallments,
      callbackUrl: params.callbackUrl,
      buyer: {
        id: order.customerId,
        ...name,
        email: order.customer.email,
        identityNumber,
        registrationAddress: address(invoice).address,
        city: invoice.city,
        country: 'Turkey',
        ip: params.buyerIp,
        ...(gsmNumber ? { gsmNumber } : {}),
      },
      shippingAddress: address(shipping),
      billingAddress: address(invoice),
      basketItems: payment.providerItems.map((item) => ({
        id: item.providerItemId,
        name: item.orderLine?.productName.slice(0, 100) ?? 'Kargo',
        category1: item.kind === 'shipping' ? 'Kargo' : 'Ev ve Yaşam',
        itemType: item.kind === 'shipping' ? 'VIRTUAL' : 'PHYSICAL',
        price: iyzico.toIyzicoPrice(item.amount),
      })),
    })
    if (outcome.kind !== 'success') {
      // No URL was disclosed to a browser, so this initialization cannot collect card data.
      await prisma.cardPaymentAttempt.updateMany({
        where: { id: attempt.id, status: 'initialized' },
        data: {
          status: 'failed',
          errorCode:
            outcome.kind === 'unknown'
              ? outcome.reason
              : /^\d{1,10}$/.test(outcome.errorCode ?? '')
                ? (outcome.errorCode ?? 'CF_INITIALIZE_FAILED')
                : 'CF_INITIALIZE_FAILED',
          completedAt: now(),
        },
      })
      throw new DomainError(
        'Ödeme alanı açılamadı. Lütfen yeniden deneyin.',
        'CHECKOUT_FORM_START_FAILED',
        503,
        { orderId: order.id },
      )
    }
    const expiresAt = new Date(now().getTime() + outcome.data.expiresInSeconds * 1000)
    // Keep the reservation until the provider session has expired, even on a retry.
    await prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, attempt.orderId)
      await tx.cardPaymentAttempt.update({
        where: { id: attempt.id },
        data: {
          checkoutFormToken: outcome.data.token,
          checkoutFormUrl: outcome.data.iframeUrl,
          checkoutFormExpiresAt: expiresAt,
          status: 'checkout_form_pending',
        },
      })
      await tx.order.update({
        where: { id: attempt.orderId },
        data: { cardPaymentExpiresAt: new Date(expiresAt.getTime() + 60_000) },
      })
    })
    return present(await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
  }

  async function reconcile(attemptId: string): Promise<CallbackOutcome> {
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })
    if (terminal.includes(attempt.status))
      return attempt.status === 'succeeded' ? 'succeeded' : 'failed'
    if (!attempt.checkoutFormToken) return 'pending'
    const result = await gateway.retrieveCheckoutForm({
      token: attempt.checkoutFormToken,
      conversationId: attempt.conversationId,
    })
    await prisma.cardPaymentAttempt.updateMany({
      where: { id: attempt.id },
      data: { updatedAt: now() },
    })
    if (result.kind !== 'success') return 'pending' // Rejection/query failure is not proof of no capture.
    const detail = result.data
    if (detail.conversationId !== attempt.conversationId) return 'invalid'
    if (attempt.providerPaymentId && attempt.providerPaymentId !== detail.paymentId)
      return 'invalid'
    if (detail.paymentStatus === 'FAILURE') {
      // During bank authentication CF can report FAILURE while the underlying
      // payment is still INIT_THREEDS. Never tear down a live bank challenge.
      const payment = await gateway.retrievePayment({
        paymentId: detail.paymentId,
        paymentConversationId: attempt.conversationId,
        conversationId: `cf-status-${attempt.id}`,
      })
      if (payment.kind !== 'success' || payment.data.paymentId !== detail.paymentId)
        return 'pending'
      if (payment.data.paymentStatus === 'SUCCESS') {
        await prisma.cardPaymentAttempt.updateMany({
          where: { id: attempt.id, status: { notIn: terminal as CardPaymentAttempt['status'][] } },
          data: { providerPaymentId: detail.paymentId, status: 'outcome_unknown' },
        })
        return 'pending'
      }
      const bankRejected =
        payment.data.paymentStatus === 'CALLBACK_THREEDS' &&
        detail.mdStatus !== null &&
        /^[0-8]$/.test(detail.mdStatus) &&
        detail.mdStatus !== '1'
      if (payment.data.paymentStatus !== 'FAILURE' && !bankRejected) return 'pending'
      await prisma.cardPaymentAttempt.updateMany({
        where: { id: attempt.id, status: { notIn: terminal as CardPaymentAttempt['status'][] } },
        data: { status: 'failed', completedAt: now(), errorCode: 'CF_PAYMENT_FAILED' },
      })
      return 'failed'
    }
    if (detail.paymentStatus !== 'SUCCESS') return 'pending'
    if (detail.conversationId !== attempt.conversationId) return 'invalid'
    if (attempt.providerPaymentId && attempt.providerPaymentId !== detail.paymentId)
      return 'invalid'
    await prisma.cardPaymentAttempt.updateMany({
      where: { id: attempt.id, providerPaymentId: null },
      data: {
        providerPaymentId: detail.paymentId,
        status: 'outcome_unknown',
        authRequestedAt: now(),
      },
    })
    // CF result signatures do not cover 3DS status. Confirm forced 3DS via a server-side report.
    const report = await gateway.getPaymentReport({
      paymentConversationId: attempt.conversationId,
      conversationId: `cf-3ds-${attempt.id}`,
    })
    if (report.kind !== 'success') return 'pending'
    const paid = report.data.find((p) => p.paymentId === detail.paymentId)
    if (!paid) return 'pending'
    return processCapturedPayment(attempt.id, { ...detail, mdStatus: paid.threeDS ? '1' : '0' })
  }

  async function abandon(userId: string, attemptId: string) {
    const attempt = await prisma.cardPaymentAttempt.findFirst({
      where: { id: attemptId, userId, flow: CHECKOUT_FORM_FLOW },
    })
    if (!attempt) return
    await prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, attempt.orderId)
      await tx.cardPaymentAttempt.updateMany({
        where: {
          orderId: attempt.orderId,
          userId,
          flow: CHECKOUT_FORM_FLOW,
          status: { notIn: terminal as CardPaymentAttempt['status'][] },
        },
        data: { supersededAt: now() },
      })
      await tx.order.updateMany({
        where: { id: attempt.orderId, status: 'payment_pending' },
        data: { cardPaymentExpiresAt: now() },
      })
    })
    await expireOrder(attempt.orderId)
  }
  return { preview, start, reuse, reconcile, abandon }
}
