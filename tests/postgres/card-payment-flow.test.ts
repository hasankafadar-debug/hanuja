/**
 * Kart ödemesi (iyzico standart sanal POS, 3DS, taksit) — gerçek PostgreSQL ile uçtan uca.
 *
 * iyzico ağ geçidi taklit edilir; teklif, sipariş, deneme, kilitler, onay, iade ve süre dolumu
 * gerçek veritabanında çalışır. Kurallar: docs/05-security/payment-security.md §2, §7.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(async () => undefined),
}))
vi.mock('../../api/jobs/refund-processing.job', () => ({
  enqueueRefundProcessing: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/refund-notification.service', () => ({
  enqueueCustomerRefundCompletedNotification: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/product-stock-sync', () => ({
  wakeStockSearchProjection: vi.fn(async () => undefined),
}))

import {
  createCardPaymentService,
  type CardPaymentGateway,
} from '../../api/services/card-payment.service'
import { createQuantityCancellationService } from '../../api/services/quantity-cancellation.service'
import { createRefundExecutionService } from '../../api/services/refund-execution.service'
import * as legalDocuments from '../../api/lib/legal-documents'
import {
  computeIyzicoSignature,
  type IyzicoOutcome,
  type IyzicoPaymentDetail,
  type PaymentReport,
} from '../../api/lib/iyzico'

process.env.IYZICO_CARD_PAYMENTS_ENABLED = 'true'

const testUrl = process.env.FINANCE_TEST_DATABASE_URL
if (!testUrl) throw new Error('FINANCE_TEST_DATABASE_URL must point to a disposable local database')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_finance_test') {
  throw new Error('Refusing finance tests outside local hanuja_finance_test database')
}
const schema = `finance_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'db',
      'push',
      '--schema',
      resolve('../db/schema/schema.prisma'),
      '--skip-generate',
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
})

afterAll(async () => {
  // Only the random schema created above is removed; never reset a supplied database.
  if (!/^finance_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

// ─── Sahte iyzico ────────────────────────────────────────────────────────────

type Basket = {
  paymentId: string
  conversationId: string
  basketId: string
  price: string
  paidPrice: string
  installment: number
  items: Array<{ id: string; price: string }>
}

// iyzico paymentId değerleri benzersizdir; testler aynı şemayı paylaştığı için sayaç ortaktır.
let paymentSequence = 22416000

function createFakeIyzico() {
  const baskets = new Map<string, Basket>()
  const cfTokens = new Map<string, string>()
  const state = {
    /** 3 taksitte müşteriye yansıyan vade farkı oranı */
    installmentRate: new Decimal('0.08'),
    authOutcome: 'success' as 'success' | 'failure' | 'unknown',
    authFraudStatus: 1,
    retrieveFraudStatus: 1,
    retrievePaymentStatus: 'SUCCESS',
    cfStatus: 'INIT',
    cfInstallment: 3,
    cfThreeDS: true,
    cfOverride: {} as Partial<IyzicoPaymentDetail>,
  }

  function detailFor(
    basket: Basket,
    fraudStatus: number,
    paymentStatus: string,
  ): IyzicoPaymentDetail {
    const price = new Decimal(basket.price)
    const paid = new Decimal(basket.paidPrice)
    // Gerçek iyzico gibi: taksitte kalem paidPrice oransal ve 8 ondalıklıdır (ör. 673.56752371);
    // toplamı paidPrice'tan kuruşun altında sapabilir.
    const itemTransactions = basket.items.map((item, index) => {
      const itemPrice = new Decimal(item.price)
      return {
        itemId: item.id,
        paymentTransactionId: `${basket.paymentId}-${index}`,
        price: itemPrice.toFixed(2),
        paidPrice: itemPrice.mul(paid).div(price).toDecimalPlaces(8).toString(),
      }
    })
    return {
      paymentId: basket.paymentId,
      conversationId: basket.conversationId,
      basketId: basket.basketId,
      currency: 'TRY',
      price: price.toFixed(2),
      paidPrice: paid.toFixed(2),
      installment: basket.installment,
      fraudStatus,
      mdStatus: '1',
      paymentStatus,
      binNumber: '55287900',
      lastFourDigits: '0008',
      cardType: 'CREDIT_CARD',
      cardAssociation: 'MASTER_CARD',
      cardFamily: 'Paraf',
      iyziCommissionFee: '0.25',
      iyziCommissionRateAmount: '33.99',
      merchantPayoutAmount: paid.sub('34.24').toFixed(2),
      itemTransactions,
    }
  }

  const gateway = {
    initializeCheckoutForm: vi.fn(
      async (params: Parameters<NonNullable<CardPaymentGateway['initializeCheckoutForm']>>[0]) => {
        const paymentId = String(paymentSequence++)
        const token = `sandbox-${randomUUID()}`
        cfTokens.set(token, paymentId)
        baskets.set(paymentId, {
          paymentId,
          conversationId: params.conversationId,
          basketId: params.basketId,
          price: params.price,
          paidPrice: new Decimal(params.price).mul(state.cfInstallment > 1 ? '1.08' : 1).toFixed(2),
          installment: state.cfInstallment,
          items: params.basketItems.map((item) => ({ id: item.id, price: item.price })),
        })
        return {
          kind: 'success' as const,
          data: {
            token,
            iframeUrl: `https://sandbox-cpp.iyzipay.com?token=${token}&iframe=true`,
            expiresInSeconds: 1800,
          },
        }
      },
    ),
    retrieveCheckoutForm: vi.fn(
      async ({ token }: { token: string }): Promise<IyzicoOutcome<IyzicoPaymentDetail>> => {
        const basket = baskets.get(cfTokens.get(token) ?? '')
        if (!basket) return { kind: 'unknown', reason: 'not_found' }
        return {
          kind: 'success',
          data: {
            ...detailFor(basket, state.retrieveFraudStatus, state.cfStatus),
            ...state.cfOverride,
          },
        }
      },
    ),
    getInstallmentOptions: vi.fn(async ({ price }: { price: string }) => {
      const base = new Decimal(price)
      const total3 = base.mul(new Decimal(1).add(state.installmentRate)).toDecimalPlaces(2)
      return {
        kind: 'success' as const,
        data: {
          binNumber: '55287900',
          cardType: 'CREDIT_CARD',
          cardAssociation: 'MASTER_CARD',
          cardFamily: 'Paraf',
          bankName: 'Halkbank',
          commercial: false,
          options: [
            {
              installmentNumber: 1,
              installmentPrice: base.toFixed(2),
              totalPrice: base.toFixed(2),
            },
            {
              installmentNumber: 3,
              installmentPrice: total3.div(3).toDecimalPlaces(2).toFixed(2),
              totalPrice: total3.toFixed(2),
            },
          ],
        },
      }
    }),
    initiate3DS: vi.fn(async (params: Parameters<CardPaymentGateway['initiate3DS']>[0]) => {
      const paymentId = String(paymentSequence++)
      baskets.set(paymentId, {
        paymentId,
        conversationId: params.conversationId,
        basketId: params.basketId,
        price: params.price,
        paidPrice: params.paidPrice,
        installment: params.installment,
        items: params.basketItems.map((item) => ({ id: item.id, price: item.price })),
      })
      return { kind: 'success' as const, data: { paymentId, htmlContent: '<form>3ds</form>' } }
    }),
    complete3DS: vi.fn(
      async (
        params: Parameters<CardPaymentGateway['complete3DS']>[0],
      ): Promise<IyzicoOutcome<IyzicoPaymentDetail>> => {
        const basket = baskets.get(params.paymentId)
        if (
          !basket ||
          basket.paidPrice !== params.paidPrice ||
          basket.basketId !== params.basketId
        ) {
          return { kind: 'failure', errorCode: '10051', errorMessage: 'Tutar uyuşmazlığı' }
        }
        if (state.authOutcome === 'unknown') return { kind: 'unknown', reason: 'timeout' }
        if (state.authOutcome === 'failure') {
          return { kind: 'failure', errorCode: '10051', errorMessage: 'Kart limiti yetersiz' }
        }
        return { kind: 'success', data: detailFor(basket, state.authFraudStatus, 'SUCCESS') }
      },
    ),
    retrievePayment: vi.fn(
      async (params: { paymentId: string }): Promise<IyzicoOutcome<IyzicoPaymentDetail>> => {
        const basket = baskets.get(params.paymentId)
        if (!basket) return { kind: 'failure', errorMessage: 'Ödeme bulunamadı' }
        return {
          kind: 'success',
          data: detailFor(basket, state.retrieveFraudStatus, state.retrievePaymentStatus),
        }
      },
    ),
    getPaymentReport: vi.fn(
      async (params: {
        paymentConversationId: string
      }): Promise<IyzicoOutcome<PaymentReport[]>> => ({
        kind: 'success',
        data: [...cfTokens.values()]
          .map((id) => baskets.get(id)!)
          .filter((b) => b.conversationId === params.paymentConversationId)
          .map((b) => ({
            paymentId: b.paymentId,
            paymentStatus: 1,
            refundStatus: null,
            threeDS: state.cfThreeDS,
            fraudStatus: state.retrieveFraudStatus,
            price: b.price,
            paidPrice: b.paidPrice,
            installment: b.installment,
            basketId: b.basketId,
            refunds: [],
          })),
      }),
    ),
    cancelPayment: vi.fn(async () => ({ kind: 'success' as const, data: { price: null } })),
    refundPayment: vi.fn(async () => ({ success: true, paymentTransactionId: 'refund-tx' })),
  } satisfies CardPaymentGateway

  return { gateway, state, baskets, detailFor }
}

// ─── Fikstür ─────────────────────────────────────────────────────────────────

const CARD = {
  cardHolderName: 'Ayse Yilmaz',
  cardNumber: '5528790000000008',
  expireMonth: '12',
  expireYear: '2030',
  cvc: '123',
}
const OTHER_CARD = { ...CARD, cardNumber: '4766620000000001' }
const ACCEPTANCE = {
  acceptedAt: new Date(),
  ipAddress: '203.0.113.5',
  userAgent: 'vitest',
  sessionId: null,
}

/** Sepet: 600 + 350,01 ürün, 99 kargo (1500 altı) → peşin 1049,01; 3 taksit %8 → 1132,93. */
async function checkoutFixture(options: { coupon?: boolean; corporate?: boolean } = {}) {
  const tag = randomUUID().slice(0, 12)
  const customer = await prisma.user.create({
    data: { email: `customer-${tag}@example.test`, name: 'Ayşe Yılmaz', emailVerified: true },
  })
  const address = await prisma.address.create({
    data: {
      userId: customer.id,
      fullName: 'Ayşe Yılmaz',
      phone: '05321234567',
      addressLine1: 'Moda Cad. No 1',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34710',
      isDefault: true,
      invoiceType: options.corporate ? 'corporate' : 'individual',
      tcNumber: options.corporate ? null : '10000000146',
      ...(options.corporate
        ? { companyName: 'Örnek Mimarlık AŞ', taxOffice: 'Kadıköy', taxNumber: '1234567890' }
        : {}),
    },
  })
  const sellerUser = await prisma.user.create({ data: { email: `seller-${tag}@example.test` } })
  const seller = await prisma.seller.create({
    data: {
      userId: sellerUser.id,
      slug: `seller-${tag}`,
      displayName: 'Atölye Test',
      status: 'active',
    },
  })
  const category = await prisma.category.create({ data: { slug: `sehpa-${tag}`, name: 'Sehpa' } })
  const product = (name: string, price: string) =>
    prisma.product.create({
      data: {
        brand: 'Test Brand',
        sellerId: seller.id,
        categoryId: category.id,
        name,
        slug: `${name.toLowerCase().replaceAll(' ', '-')}-${tag}`,
        price,
        stockQuantity: 5,
        status: 'published',
      },
    })
  const productA = await product('Mese Sehpa', '600.00')
  const productB = await product('Ceviz Raf', '350.01')
  const productC = await product('Seramik Vazo', '100.00')
  let couponId: string | null = null
  if (options.coupon) {
    const coupon = await prisma.coupon.create({
      data: { code: `HOS-${tag}`, discountType: 'fixed_amount', discountValue: 50 },
    })
    couponId = coupon.id
  }
  const cart = await prisma.cart.create({
    data: {
      userId: customer.id,
      ...(options.coupon ? { couponCode: `HOS-${tag}` } : {}),
      items: {
        create: [
          { productId: productA.id, quantity: 1, unitPrice: '600.00' },
          { productId: productB.id, quantity: 1, unitPrice: '350.01' },
        ],
      },
    },
  })
  return { customer, address, seller, productA, productB, productC, cart, couponId }
}

type Fixture = Awaited<ReturnType<typeof checkoutFixture>>

function harness() {
  const fake = createFakeIyzico()
  const clock = { now: new Date() }
  const service = createCardPaymentService({
    prisma,
    gateway: fake.gateway,
    now: () => clock.now,
  })
  const advance = (minutes: number) => {
    clock.now = new Date(clock.now.getTime() + minutes * 60_000)
  }
  return { ...fake, clock, advance, service }
}

type Harness = ReturnType<typeof harness>

async function startPayment(
  h: Harness,
  f: Fixture,
  options: {
    installmentCount?: number
    orderId?: string
    startKey?: string
    card?: typeof CARD
    identityNumber?: string
  } = {},
) {
  const card = options.card ?? CARD
  const quote = await h.service.createQuote({
    userId: f.customer.id,
    binNumber: card.cardNumber.slice(0, 8),
    installmentCount: options.installmentCount ?? 3,
    ...(options.orderId ? { orderId: options.orderId } : { addressId: f.address.id }),
  })
  const started = await h.service.startAttempt({
    userId: f.customer.id,
    quoteId: quote.quoteId,
    startKey: options.startKey ?? `start-${randomUUID()}`,
    card,
    ...(options.identityNumber ? { identityNumber: options.identityNumber } : {}),
    acceptance: ACCEPTANCE,
    buyerIp: '203.0.113.5',
    callbackUrl: 'https://shop.example.test/api/payment/callback',
  })
  return { quote, started }
}

async function callback(
  h: Harness,
  attemptId: string,
  overrides: Record<string, string | null> = {},
) {
  const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId } })
  return h.service.handleCallback({
    status: 'success',
    paymentId: attempt.providerPaymentId,
    conversationId: attempt.conversationId,
    conversationData: null,
    mdStatus: '1',
    signature: null,
    ...overrides,
  })
}

function sum(values: Array<Decimal | null>) {
  return values.reduce<Decimal>((total, value) => total.add(value ?? 0), new Decimal(0)).toFixed(2)
}

// ─── Testler ─────────────────────────────────────────────────────────────────

async function startCF(
  h: Harness,
  f: Fixture,
  options: { startKey?: string; orderId?: string } = {},
) {
  const preview = await h.service.previewCheckoutForm({
    userId: f.customer.id,
    ...(options.orderId ? { orderId: options.orderId } : { addressId: f.address.id }),
  })
  const params = {
    userId: f.customer.id,
    previewId: preview.previewId,
    startKey: options.startKey ?? `cf-${randomUUID()}`,
    acceptance: ACCEPTANCE,
    buyerIp: '203.0.113.5',
    callbackUrl: 'https://shop.example.test/api/payment/checkout-form/callback',
  }
  const session = await h.service.startCheckoutForm(params)
  const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
    where: { id: session.attemptId },
  })
  return { session, attempt, params, preview }
}

describe('hosted CheckoutForm: server payment boundaries', () => {
  it('copies the immutable preview even if the renderer changes before start or confirmation', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const preview = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      addressId: f.address.id,
    })
    const render = legalDocuments.renderLegalDocuments
    const spy = vi
      .spyOn(legalDocuments, 'renderLegalDocuments')
      .mockImplementation((context) => ({
        ...render(context),
        distanceSalesHtml: '<p>Changed after preview</p>',
        preInformationHtml: '<p>Changed after preview</p>',
      }))
    try {
      const session = await h.service.startCheckoutForm({
        userId: f.customer.id,
        previewId: preview.previewId,
        startKey: `cf-${randomUUID()}`,
        acceptance: ACCEPTANCE,
        buyerIp: '203.0.113.5',
        callbackUrl: 'https://shop.example.test/api/payment/checkout-form/callback',
      })
      const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: session.attemptId },
      })
      expect(attempt.distanceSalesHtml).toBe(preview.distanceSalesHtml)
      h.state.cfStatus = 'SUCCESS'
      await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)
      const snapshot = await prisma.orderLegalSnapshot.findUniqueOrThrow({
        where: { orderId: session.orderId },
      })
      expect(snapshot.distanceSalesHtml).toBe(preview.distanceSalesHtml)
      expect(snapshot.preInformationHtml).toBe(preview.preInformationHtml)
      expect(snapshot.platformSnapshot).toEqual(preview.platformSnapshot)
    } finally {
      spy.mockRestore()
    }
  })

  it('rejects an obsolete preview version before reserving an order', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const preview = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      addressId: f.address.id,
    })
    await prisma.checkoutFormPreview.update({
      where: { id: preview.previewId },
      data: { documents: { ...preview, distanceSalesVersion: 'obsolete' } },
    })
    await expect(
      h.service.startCheckoutForm({
        userId: f.customer.id,
        previewId: preview.previewId,
        startKey: `cf-${randomUUID()}`,
        acceptance: ACCEPTANCE,
        buyerIp: '203.0.113.5',
        callbackUrl: 'https://shop.example.test/api/payment/checkout-form/callback',
      }),
    ).rejects.toMatchObject({ code: 'CHECKOUT_FORM_PREVIEW_EXPIRED' })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0)
  })
  it('closes the legacy bank form before a CF retry, so its later callback cannot authorize', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('Legacy fixture did not initialize')
    await startCF(h, f, { orderId: started.orderId })
    expect((await callback(h, started.attemptId)).outcome).toBe('expired')
    expect(h.gateway.complete3DS).not.toHaveBeenCalled()
  })
  it('reconciles a captured form before expiring its reservation', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { session } = await startCF(h, f)
    h.state.cfStatus = 'SUCCESS'
    h.advance(32)
    await h.service.runMaintenance()
    expect((await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status).toBe(
      'seller_queue_ready',
    )
  })

  it('holds an uncertain reservation when payment is captured but CF has not caught up', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { session, attempt } = await startCF(h, f)
    h.state.cfStatus = 'FAILURE'
    h.state.retrievePaymentStatus = 'SUCCESS'
    h.advance(32)
    await h.service.runMaintenance()
    expect(
      (await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
    ).toBe('outcome_unknown')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status).toBe(
      'payment_pending',
    )
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(4)
  })
  it('keeps the bank challenge alive when CF temporarily says FAILURE but signed payment detail says INIT_THREEDS', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { attempt } = await startCF(h, f)
    h.state.cfStatus = 'FAILURE'
    h.state.retrievePaymentStatus = 'INIT_THREEDS'
    expect((await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).outcome).toBe(
      'pending',
    )
    expect(
      (await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status,
    ).toBe('checkout_form_pending')
    h.state.retrievePaymentStatus = 'CALLBACK_THREEDS'
    h.state.cfOverride = { mdStatus: '0' }
    expect((await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).outcome).toBe(
      'failed',
    )
  })
  it('keeps card/installment fields unknown and reuses one reservation on duplicate/reloaded intent', async () => {
    const h = harness(),
      f = await checkoutFixture({ coupon: true })
    const { session, attempt, params, preview } = await startCF(h, f)
    expect(attempt).toMatchObject({
      flow: 'checkout_form',
      quoteId: null,
      installmentCount: null,
      paidPrice: null,
      binNumber: null,
      status: 'checkout_form_pending',
    })
    expect(await h.service.startCheckoutForm(params)).toEqual(session)
    expect(session.startKey).toBe(params.startKey)
    const reloaded = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      addressId: f.address.id,
    })
    expect(reloaded.previewId).toBe(preview.previewId)
    const orderResume = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      orderId: session.orderId,
    })
    expect(orderResume.previewId).toBe(preview.previewId)
    expect(
      await h.service.startCheckoutForm({ ...params, previewId: orderResume.previewId }),
    ).toEqual(session)
    expect(
      await h.service.startCheckoutForm({
        ...params,
        previewId: reloaded.previewId,
        startKey: `cf-${randomUUID()}`,
      }),
    ).toEqual(session)
    expect(h.gateway.initializeCheckoutForm).toHaveBeenCalledTimes(1)
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await prisma.couponUsage.count({ where: { orderId: session.orderId } })).toBe(1)
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(4)
    expect(JSON.stringify(h.gateway.initializeCheckoutForm.mock.calls)).not.toContain('cardNumber')
  })

  it('serializes concurrent requests before writing stock or coupons', async () => {
    const h = harness(),
      f = await checkoutFixture({ coupon: true })
    const preview = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      addressId: f.address.id,
    })
    const params = {
      userId: f.customer.id,
      previewId: preview.previewId,
      startKey: `cf-${randomUUID()}`,
      acceptance: ACCEPTANCE,
      buyerIp: '203.0.113.5',
      callbackUrl: 'https://shop.example.test/api/payment/checkout-form/callback',
    }
    const outcomes = await Promise.allSettled([
      h.service.startCheckoutForm(params),
      h.service.startCheckoutForm(params),
    ])
    expect(outcomes.some((r) => r.status === 'fulfilled')).toBe(true)
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(h.gateway.initializeCheckoutForm).toHaveBeenCalledTimes(1)
  })

  it('confirms signed installments without rewriting accepted documents or designer accrual', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { session, attempt, preview } = await startCF(h, f)
    h.state.cfStatus = 'SUCCESS'
    expect(await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).toEqual({
      orderId: session.orderId,
      outcome: 'succeeded',
    })
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: session.orderId },
      include: { legalSnapshot: true, lines: true },
    })
    expect(order.status).toBe('seller_queue_ready')
    expect(order.totalAmount.toFixed(2)).toBe('1132.93')
    expect(order.installmentCount).toBe(3)
    expect(order.legalSnapshot?.distanceSalesHtml).toBe(preview.distanceSalesHtml)
    expect(order.legalSnapshot?.preInformationHtml).toBe(preview.preInformationHtml)
    expect(order.legalSnapshot?.distanceSalesHash).toBe(attempt.distanceSalesHash)
    expect(sum(order.lines.map((l) => l.totalPrice))).toBe('950.01')
    expect(
      sum(
        (
          await prisma.sellerLedgerEntry.findMany({
            where: { sellerId: f.seller.id, type: 'sale' },
          })
        ).map((l) => l.amount),
      ),
    ).toBe('950.01')
    await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)
    expect(
      await prisma.paymentEvent.count({
        where: { paymentId: attempt.paymentId, eventType: 'card_payment_confirmed' },
      }),
    ).toBe(1)
  })

  it.each(['md', 'basket', 'currency', 'installment', 'items'] as const)(
    'reverses an unusable captured result: %s',
    async (failure) => {
      const h = harness(),
        f = await checkoutFixture()
      const { session, attempt } = await startCF(h, f)
      if (failure === 'md') h.state.cfThreeDS = false
      if (failure === 'basket') h.state.cfOverride = { basketId: 'wrong' }
      if (failure === 'currency') h.state.cfOverride = { currency: 'USD' }
      if (failure === 'installment') h.state.cfOverride = { installment: 99 }
      if (failure === 'items') h.state.cfOverride = { itemTransactions: [] }
      h.state.cfStatus = 'SUCCESS'
      expect((await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).outcome).toBe(
        'failed',
      )
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status,
      ).toBe('payment_pending')
      expect(await prisma.cardAttemptReversal.count({ where: { attemptId: attempt.id } })).toBe(1)
    },
  )

  it('releases an abandoned reservation once and reverses a late capture', async () => {
    const h = harness(),
      f = await checkoutFixture({ coupon: true })
    const { session, attempt } = await startCF(h, f)
    await h.service.abandonCheckoutForm(f.customer.id, attempt.id)
    await h.service.abandonCheckoutForm(f.customer.id, attempt.id)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status).toBe(
      'payment_cancelled',
    )
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(5)
    expect(await prisma.couponUsage.count({ where: { orderId: session.orderId } })).toBe(0)
    h.state.cfStatus = 'SUCCESS'
    expect((await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).outcome).toBe(
      'failed',
    )
    expect(await prisma.cardAttemptReversal.count({ where: { attemptId: attempt.id } })).toBe(1)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status).toBe(
      'payment_cancelled',
    )
  })

  it('invalidates all older provider forms before releasing a retried order reservation', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const first = await startCF(h, f)
    h.state.cfStatus = 'FAILURE'
    h.state.retrievePaymentStatus = 'FAILURE'
    await h.service.handleCheckoutFormCallback(first.attempt.checkoutFormToken!)
    h.state.cfStatus = 'INIT'
    const second = await startCF(h, f, { orderId: first.session.orderId })
    await h.service.abandonCheckoutForm(f.customer.id, second.attempt.id)
    expect(
      (await prisma.order.findUniqueOrThrow({ where: { id: first.session.orderId } })).status,
    ).toBe('payment_cancelled')
    expect(
      (await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: first.attempt.id } }))
        .supersededAt,
    ).not.toBeNull()
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(5)
  })

  it('does not confirm unverified provider results and expires unpaid sessions with stock release', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const { session, attempt } = await startCF(h, f)
    h.gateway.retrieveCheckoutForm.mockResolvedValueOnce({
      kind: 'unknown',
      reason: 'signature_mismatch',
    })
    expect((await h.service.handleCheckoutFormCallback(attempt.checkoutFormToken!)).outcome).toBe(
      'pending',
    )
    h.advance(32)
    await h.service.runMaintenance()
    expect((await prisma.order.findUniqueOrThrow({ where: { id: session.orderId } })).status).toBe(
      'payment_cancelled',
    )
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(5)
  })

  it('rejects cart/address changes after preview before any reservation', async () => {
    const h = harness(),
      f = await checkoutFixture()
    const preview = await h.service.previewCheckoutForm({
      userId: f.customer.id,
      addressId: f.address.id,
    })
    await prisma.address.update({
      where: { id: f.address.id },
      data: { addressLine1: 'Changed address' },
    })
    await expect(
      h.service.startCheckoutForm({
        userId: f.customer.id,
        previewId: preview.previewId,
        startKey: `cf-${randomUUID()}`,
        acceptance: ACCEPTANCE,
        buyerIp: '203.0.113.5',
        callbackUrl: 'https://shop.example.test/api/payment/checkout-form/callback',
      }),
    ).rejects.toMatchObject({ code: 'CARD_CART_CHANGED' })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0)
  })
})

describe('kart ödemesi: teklif → 3DS → onay', () => {
  it('3 taksitte vade farkını müşteri öder; tasarımcı tahakkuku peşin tutarda kalır', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { quote, started } = await startPayment(h, f)

    expect(quote.price).toBe('1049.01')
    expect(quote.selected).toMatchObject({
      installmentNumber: 3,
      totalPrice: '1132.93',
      differenceAmount: '83.92',
    })
    expect(quote.offers.map((offer) => offer.installmentNumber)).toEqual([1, 3])
    expect(started.kind).toBe('threeds')
    if (started.kind !== 'threeds') return

    const pending = await prisma.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { legalSnapshot: true },
    })
    expect(pending.status).toBe('payment_pending')
    expect(pending.totalAmount.toFixed(2)).toBe('1049.01')
    expect(pending.legalSnapshot).toBeNull()
    expect(pending.cardPaymentExpiresAt!.getTime()).toBeGreaterThan(h.clock.now.getTime())

    // Ödeme beklerken sepete eklenen ürün onayda silinmemeli.
    await prisma.cartItem.create({
      data: { cartId: f.cart.id, productId: f.productC.id, quantity: 1, unitPrice: '100.00' },
    })

    expect(await callback(h, started.attemptId)).toEqual({
      orderId: started.orderId,
      outcome: 'succeeded',
    })

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { lines: true, payments: { include: { providerItems: true } }, legalSnapshot: true },
    })
    expect(order.status).toBe('seller_queue_ready')
    expect(order.totalAmount.toFixed(2)).toBe('1132.93')
    expect(order.installmentCount).toBe(3)
    expect(order.installmentDifferenceAmount!.toFixed(2)).toBe('83.92')
    expect(order.installmentTotalAmount!.toFixed(2)).toBe('1132.93')
    // Ürün ve kargo payları kuruşu kuruşuna tahsilata eşit.
    expect(
      sum([
        ...order.lines.map((line) => line.customerPaidProductAmount),
        order.customerPaidShippingAmount,
      ]),
    ).toBe('1132.93')
    // Tasarımcı alanları değişmez.
    expect(sum(order.lines.map((line) => line.totalPrice))).toBe('950.01')

    const payment = order.payments[0]!
    expect(payment.status).toBe('confirmed')
    expect(payment.amount.toFixed(2)).toBe('1132.93')
    expect(sum(payment.providerItems.map((item) => item.amount))).toBe('1132.93')
    expect(payment.providerItems.every((item) => item.providerTransactionId)).toBe(true)

    expect(order.legalSnapshot?.preInformationHtml).toContain('Taksit Sayısı')
    expect(order.legalSnapshot?.preInformationHtml).toContain('1.132,93')

    const sales = await prisma.sellerLedgerEntry.findMany({
      where: { sellerId: f.seller.id, type: 'sale' },
    })
    expect(sum(sales.map((entry) => entry.amount))).toBe('950.01')

    const cartItems = await prisma.cartItem.findMany({ where: { cartId: f.cart.id } })
    expect(cartItems.map((item) => item.productId)).toEqual([f.productC.id])

    // Tekrar gelen callback yeni etki üretmez.
    expect(await callback(h, started.attemptId)).toEqual({
      orderId: started.orderId,
      outcome: 'succeeded',
    })
    expect(h.gateway.complete3DS).toHaveBeenCalledTimes(1)
    expect(
      await prisma.paymentEvent.count({
        where: { paymentId: payment.id, eventType: 'card_payment_confirmed' },
      }),
    ).toBe(1)

    // İptal edilen ürünlerin vade farkı payı ve kargonun müşteri tutarı iade edilir.
    await createQuantityCancellationService({ prisma }).create({
      orderId: order.id,
      customerId: f.customer.id,
      reason: 'Vazgeçtim',
      items: order.lines.map((line) => ({ orderLineId: line.id, quantity: line.quantity })),
    })
    const refunds = await prisma.refundTransaction.findMany({ where: { orderId: order.id } })
    expect(sum(refunds.map((refund) => refund.customerAmount))).toBe('1132.93')
    expect(sum(refunds.map((refund) => refund.grossProductAmount))).toBe('950.01')
  })

  it('teklif sonrası oran değişirse ödeme başlamaz ve sipariş açılmaz', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const quote = await h.service.createQuote({
      userId: f.customer.id,
      binNumber: '55287900',
      installmentCount: 3,
      addressId: f.address.id,
    })
    h.state.installmentRate = new Decimal('0.09')
    await expect(
      h.service.startAttempt({
        userId: f.customer.id,
        quoteId: quote.quoteId,
        startKey: `start-${randomUUID()}`,
        card: CARD,
        acceptance: ACCEPTANCE,
        buyerIp: '203.0.113.5',
        callbackUrl: 'https://shop.example.test/api/payment/callback',
      }),
    ).rejects.toMatchObject({ code: 'CARD_QUOTE_CHANGED' })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0)
    expect(h.gateway.initiate3DS).not.toHaveBeenCalled()
  })

  it('aynı isteğin eşzamanlı iki kez gelmesi tek sipariş ve tek 3DS denemesi üretir', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const quote = await h.service.createQuote({
      userId: f.customer.id,
      binNumber: '55287900',
      installmentCount: 1,
      addressId: f.address.id,
    })
    const request = {
      userId: f.customer.id,
      quoteId: quote.quoteId,
      startKey: `start-${randomUUID()}`,
      card: CARD,
      acceptance: ACCEPTANCE,
      buyerIp: '203.0.113.5',
      callbackUrl: 'https://shop.example.test/api/payment/callback',
    }
    const results = await Promise.all([
      h.service.startAttempt(request),
      h.service.startAttempt(request),
    ])
    expect(results.map((result) => result.kind).sort()).toEqual(['existing', 'threeds'])
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(1)
    expect(await prisma.cardPaymentAttempt.count({ where: { userId: f.customer.id } })).toBe(1)
    expect(h.gateway.initiate3DS).toHaveBeenCalledTimes(1)
  })

  it('kurumsal fatura profili iyzico teyidi gelene kadar sipariş açmadan reddedilir', async () => {
    const h = harness()
    const f = await checkoutFixture({ corporate: true })
    await expect(startPayment(h, f)).rejects.toMatchObject({ code: 'CARD_IDENTITY_UNSUPPORTED' })
    expect(await prisma.order.count({ where: { customerId: f.customer.id } })).toBe(0)
  })
})

describe('kart ödemesi: callback güvenliği ve başarısızlık', () => {
  it('başka bir ödemenin paymentId değeriyle gelen callback auth çağırmaz', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    expect(await callback(h, started.attemptId, { paymentId: '99999999' })).toMatchObject({
      outcome: 'invalid',
    })
    expect(h.gateway.complete3DS).not.toHaveBeenCalled()
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    })
    expect(attempt.status).toBe('threeds_pending')
  })

  it('3DS doğrulanmazsa deneme başarısız olur, sipariş yeniden ödemeye açık kalır', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    expect(
      await callback(h, started.attemptId, { mdStatus: '0', status: 'failure' }),
    ).toMatchObject({
      outcome: 'failed',
    })
    expect(h.gateway.complete3DS).not.toHaveBeenCalled()
    const state = await h.service.getOrderPaymentState(f.customer.id, started.orderId)
    expect(state).toMatchObject({ payable: true, checking: false, status: 'payment_pending' })
  })

  it('başarısız 3DS dönüşü paymentId taşımaz; imzası geçerliyse deneme başarısız olur, imzasızsa reddedilir', async () => {
    // Gerçek iyzico (sandbox, 2026-10-17): status=failure, mdStatus=0, paymentId yok, imza geçerli.
    const previousKey = process.env.IYZICO_SECRET_KEY
    process.env.IYZICO_SECRET_KEY = 'test-secret'
    try {
      const h = harness()
      const unsigned = await startPayment(h, await checkoutFixture())
      if (unsigned.started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
      expect(
        await callback(h, unsigned.started.attemptId, {
          status: 'failure',
          mdStatus: '0',
          paymentId: null,
        }),
      ).toMatchObject({ outcome: 'invalid' })
      expect(
        (
          await prisma.cardPaymentAttempt.findUniqueOrThrow({
            where: { id: unsigned.started.attemptId },
          })
        ).status,
      ).toBe('threeds_pending')

      const signed = await startPayment(h, await checkoutFixture())
      if (signed.started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
      const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: signed.started.attemptId },
      })
      const signature = computeIyzicoSignature(['', attempt.conversationId, '0', '', 'failure'])
      expect(
        await callback(h, attempt.id, {
          status: 'failure',
          mdStatus: '0',
          paymentId: null,
          signature,
        }),
      ).toMatchObject({ outcome: 'failed' })
      const failed = await prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      })
      expect(failed).toMatchObject({ status: 'failed', mdStatus: '0' })
      expect(h.gateway.complete3DS).not.toHaveBeenCalled()

      // Başarı bildiriminde paymentId eşleşmesi imza geçerli olsa da şarttır.
      const third = await startPayment(h, await checkoutFixture())
      if (third.started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
      const thirdAttempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
        where: { id: third.started.attemptId },
      })
      const successSignature = computeIyzicoSignature([
        '',
        thirdAttempt.conversationId,
        '1',
        '',
        'success',
      ])
      expect(
        await callback(h, thirdAttempt.id, { paymentId: null, signature: successSignature }),
      ).toMatchObject({ outcome: 'invalid' })
      expect(h.gateway.complete3DS).not.toHaveBeenCalled()
    } finally {
      if (previousKey === undefined) delete process.env.IYZICO_SECRET_KEY
      else process.env.IYZICO_SECRET_KEY = previousKey
    }
  })

  it('3DS ekranı kapatılırsa başka kartla devam edilir; eski callback para çekemez', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const first = await startPayment(h, f)
    if (first.started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    const second = await startPayment(h, f, { orderId: first.started.orderId, card: OTHER_CARD })
    if (second.started.kind !== 'threeds') throw new Error('3DS bekleniyordu')

    const old = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: first.started.attemptId },
    })
    expect(old.status).toBe('expired')
    expect(await callback(h, first.started.attemptId)).toMatchObject({ outcome: 'expired' })
    expect(h.gateway.complete3DS).not.toHaveBeenCalled()

    expect(await callback(h, second.started.attemptId)).toMatchObject({ outcome: 'succeeded' })
    expect(h.gateway.complete3DS).toHaveBeenCalledTimes(1)
  })

  it('yarım bırakılan ödeme süre sonunda iptal olur; stok ve kupon geri gelir, geç callback para çekmez', async () => {
    const h = harness()
    const f = await checkoutFixture({ coupon: true })
    const { quote, started } = await startPayment(h, f, { installmentCount: 1 })
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    expect(quote.price).toBe('999.01')
    expect(await prisma.couponUsage.count({ where: { couponId: f.couponId! } })).toBe(1)
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(4)

    h.advance(31)
    const summary = await h.service.runMaintenance()
    // Aynı şemadaki diğer testlerin süresi dolmuş siparişleri de iptal edilir.
    expect(summary.expired).toBeGreaterThanOrEqual(1)

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { payments: true },
    })
    expect(order.status).toBe('payment_cancelled')
    expect(order.payments[0]!.status).toBe('cancelled')
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { id: f.productA.id } })).stockQuantity,
    ).toBe(5)
    expect(await prisma.couponUsage.count({ where: { couponId: f.couponId! } })).toBe(0)
    expect((await prisma.coupon.findUniqueOrThrow({ where: { id: f.couponId! } })).usageCount).toBe(
      0,
    )

    expect(await callback(h, started.attemptId)).toMatchObject({ outcome: 'expired' })
    expect(h.gateway.complete3DS).not.toHaveBeenCalled()
    expect(await prisma.refundTransaction.count({ where: { orderId: order.id } })).toBe(0)
  })
})

describe('kart ödemesi: sonucu belirsiz ve incelemedeki tahsilat', () => {
  it('auth yanıtı kaybolursa sipariş iptal edilmez; mutabakat tahsilatı onaylar', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    h.state.authOutcome = 'unknown'
    expect(await callback(h, started.attemptId)).toMatchObject({ outcome: 'pending' })
    expect(
      (await prisma.cardPaymentAttempt.findUniqueOrThrow({ where: { id: started.attemptId } }))
        .status,
    ).toBe('outcome_unknown')

    h.advance(31)
    await h.service.expireOrder(started.orderId)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: started.orderId } })).status).toBe(
      'payment_pending',
    )

    expect(await h.service.reconcileAttempt(started.attemptId)).toBe('succeeded')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: started.orderId } })).status).toBe(
      'seller_queue_ready',
    )
  })

  it('fraudStatus=0 tasarımcıya düşmez; inceleme sonrası 2 gelince onaylanır', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    h.state.authFraudStatus = 0
    expect(await callback(h, started.attemptId)).toMatchObject({ outcome: 'review' })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: started.orderId } })).status).toBe(
      'payment_pending',
    )
    expect(await prisma.sellerLedgerEntry.count({ where: { sellerId: f.seller.id } })).toBe(0)

    h.state.retrieveFraudStatus = 0
    expect(await h.service.reconcileAttempt(started.attemptId)).toBe('review')
    h.state.retrieveFraudStatus = 2
    expect(await h.service.reconcileAttempt(started.attemptId)).toBe('succeeded')
    expect((await prisma.order.findUniqueOrThrow({ where: { id: started.orderId } })).status).toBe(
      'seller_queue_ready',
    )
  })

  it('webhook kaydı yalnız tetikleyicidir; karar imzalı sorgu yanıtıyla verilir', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    h.state.authOutcome = 'unknown'
    await callback(h, started.attemptId)
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    })
    const event = await prisma.iyzicoWebhookEvent.create({
      data: {
        iyziReferenceCode: `ref-${randomUUID()}`,
        iyziEventType: 'THREE_DS_AUTH',
        paymentId: attempt.providerPaymentId,
        paymentConversationId: attempt.conversationId,
        status: 'SUCCESS',
        payload: {},
      },
    })
    await h.service.processWebhookEvent(event.id)
    expect(
      (await prisma.iyzicoWebhookEvent.findUniqueOrThrow({ where: { id: event.id } })).processedAt,
    ).not.toBeNull()
    expect((await prisma.order.findUniqueOrThrow({ where: { id: started.orderId } })).status).toBe(
      'seller_queue_ready',
    )
  })
})

describe('kart ödemesi: siparişe bağlanamayan tahsilat geri ödenir', () => {
  it('sipariş artık ödenebilir değilken gelen tahsilat aynı gün iptal edilir', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f)
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    h.state.authOutcome = 'unknown'
    await callback(h, started.attemptId)
    // Sipariş başka bir yoldan kapandı (ör. yönetici iptali).
    await prisma.order.update({
      where: { id: started.orderId },
      data: { status: 'payment_cancelled' },
    })

    expect(await h.service.reconcileAttempt(started.attemptId)).toBe('failed')
    expect(h.gateway.cancelPayment).toHaveBeenCalledTimes(1)
    // iyzico açıklama gönderilen iptalde sebep (reason) ister.
    expect(h.gateway.cancelPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'other', description: 'late_capture' }),
    )
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
      include: { reversal: true },
    })
    expect(attempt.status).toBe('voided')
    expect(attempt.reversal).toMatchObject({
      kind: 'cancel',
      status: 'completed',
      reason: 'late_capture',
    })
  })

  it('onaylı siparişe ikinci tahsilat gelirse deneme başına tek geri ödeme açılır', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f, { installmentCount: 1 })
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    await callback(h, started.attemptId)

    const first = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    })
    const otherQuote = await prisma.cardPaymentQuote.create({
      data: {
        userId: f.customer.id,
        orderId: first.orderId,
        addressId: f.address.id,
        sourceHash: 'duplicate',
        binNumber: '47666200',
        installmentCount: 1,
        price: first.price,
        paidPrice: first.paidPrice,
        installmentPrice: first.paidPrice,
        distanceSalesVersion: first.distanceSalesVersion,
        preInformationVersion: first.preInformationVersion,
        legalContext: {},
        expiresAt: h.clock.now,
        consumedAt: h.clock.now,
      },
    })
    const duplicate = await prisma.cardPaymentAttempt.create({
      data: {
        orderId: first.orderId,
        paymentId: first.paymentId,
        quoteId: otherQuote.id,
        startKey: `start-${randomUUID()}`,
        userId: f.customer.id,
        conversationId: `hnj-${randomUUID()}`,
        providerPaymentId: 'dup-1',
        status: 'authorizing',
        installmentCount: 1,
        price: first.price,
        paidPrice: first.paidPrice,
        installmentDifferenceAmount: 0,
        binNumber: '47666200',
        distanceSalesHtml: first.distanceSalesHtml,
        preInformationHtml: first.preInformationHtml,
        distanceSalesVersion: first.distanceSalesVersion,
        preInformationVersion: first.preInformationVersion,
        distanceSalesHash: first.distanceSalesHash,
        preInformationHash: first.preInformationHash,
        acceptedAt: first.acceptedAt,
        authRequestedAt: h.clock.now,
      },
    })
    const basket = h.baskets.get(first.providerPaymentId!)!
    const detail = h.detailFor(
      { ...basket, paymentId: 'dup-1', conversationId: duplicate.conversationId },
      1,
      'SUCCESS',
    )
    expect(await h.service.processCapturedPayment(duplicate.id, detail)).toBe('failed')
    // Tekrar gelen bildirim ikinci geri ödeme açmaz.
    expect(await h.service.processCapturedPayment(duplicate.id, detail)).toBe('failed')
    expect(h.gateway.cancelPayment).toHaveBeenCalledTimes(1)
    expect(h.gateway.cancelPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'double_payment', description: 'duplicate_capture' }),
    )

    const reversals = await prisma.cardAttemptReversal.findMany({
      where: { attemptId: duplicate.id },
    })
    expect(reversals).toHaveLength(1)
    expect(reversals[0]).toMatchObject({ reason: 'duplicate_capture', status: 'completed' })
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: first.orderId },
      include: { payments: true },
    })
    // İlk tahsilat siparişte kalır.
    expect(order.payments[0]!.providerPaymentId).toBe(first.providerPaymentId)
  })
})

describe('kart iadesi güvenilirliği', () => {
  it('sonucu belirsiz iade, iyzico raporundaki kendi conversationId ile kapatılır', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f, { installmentCount: 1 })
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    await callback(h, started.attemptId)
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { lines: true, payments: true },
    })
    await createQuantityCancellationService({ prisma }).create({
      orderId: order.id,
      customerId: f.customer.id,
      reason: 'Vazgeçtim',
      items: [{ orderLineId: order.lines[0]!.id, quantity: order.lines[0]!.quantity }],
    })
    const refund = await prisma.refundTransaction.findFirstOrThrow({
      where: { orderId: order.id },
      include: { items: { include: { paymentProviderItem: true } } },
    })
    const item = refund.items[0]!
    await prisma.refundTransactionItem.update({
      where: { id: item.id },
      data: {
        status: 'manual_required',
        failureReason:
          'Önceki sağlayıcı çağrısının sonucu belirsiz; çift iadeyi önlemek için manuel mutabakat gerekli',
        lastAttemptAt: new Date(Date.now() - 5 * 60_000),
      },
    })

    const getPaymentReport = vi.fn(async () => ({
      kind: 'success' as const,
      data: [
        {
          paymentId: order.payments[0]!.providerPaymentId!,
          paymentStatus: 1,
          refundStatus: 'PARTIALLY_REFUNDED',
          threeDS: true,
          fraudStatus: 1,
          price: null,
          paidPrice: null,
          installment: 1,
          basketId: order.id,
          refunds: [
            {
              scope: 'refund' as const,
              paymentTransactionId: item.paymentProviderItem!.providerTransactionId,
              conversationId: `refund-item-${item.id}`,
              price: item.amount.toFixed(2),
              status: 1,
              providerReference: 'iyzico-refund-1',
            },
          ],
        },
      ],
    }))
    const execution = createRefundExecutionService({ prisma, getPaymentReport })
    expect(await execution.reconcileCardRefund(refund.id)).toMatchObject({ completed: 1 })

    // Rapor, denemenin conversationId'siyle sorgulanır.
    const attempt = await prisma.cardPaymentAttempt.findUniqueOrThrow({
      where: { id: started.attemptId },
    })
    expect(getPaymentReport).toHaveBeenCalledWith(
      expect.objectContaining({ paymentConversationId: attempt.conversationId }),
    )
    const settled = await prisma.refundTransactionItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { paymentProviderItem: true },
    })
    expect(settled.status).toBe('completed')
    expect(settled.providerReference).toBe('iyzico-refund-1')
    expect(settled.paymentProviderItem!.refundedAmount.toFixed(2)).toBe(item.amount.toFixed(2))
  })

  it('raporda iz yoksa ve süre geçmediyse belirsiz iade körlemesine yeniden denenmez', async () => {
    const h = harness()
    const f = await checkoutFixture()
    const { started } = await startPayment(h, f, { installmentCount: 1 })
    if (started.kind !== 'threeds') throw new Error('3DS bekleniyordu')
    await callback(h, started.attemptId)
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: started.orderId },
      include: { lines: true, payments: true },
    })
    await createQuantityCancellationService({ prisma }).create({
      orderId: order.id,
      customerId: f.customer.id,
      reason: 'Vazgeçtim',
      items: [{ orderLineId: order.lines[0]!.id, quantity: order.lines[0]!.quantity }],
    })
    const refund = await prisma.refundTransaction.findFirstOrThrow({
      where: { orderId: order.id },
      include: { items: true },
    })
    await prisma.refundTransactionItem.update({
      where: { id: refund.items[0]!.id },
      data: {
        status: 'manual_required',
        failureReason: 'Iyzico iade sonucu belirsiz: timeout',
        lastAttemptAt: new Date(),
      },
    })
    const getPaymentReport = vi.fn(async () => ({
      kind: 'success' as const,
      data: [
        {
          paymentId: order.payments[0]!.providerPaymentId!,
          paymentStatus: 1,
          refundStatus: 'NOT_REFUNDED',
          threeDS: true,
          fraudStatus: 1,
          price: null,
          paidPrice: null,
          installment: 1,
          basketId: order.id,
          refunds: [],
        },
      ],
    }))
    const execution = createRefundExecutionService({ prisma, getPaymentReport })
    expect(await execution.reconcileCardRefund(refund.id)).toMatchObject({
      completed: 0,
      reopened: 0,
      unresolved: 1,
    })
    expect(
      (await prisma.refundTransactionItem.findUniqueOrThrow({ where: { id: refund.items[0]!.id } }))
        .status,
    ).toBe('manual_required')
  })
})
