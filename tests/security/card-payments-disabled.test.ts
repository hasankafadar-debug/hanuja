import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  provider: vi.fn(),
  prisma: vi.fn(),
  service: vi.fn(),
  handleCallback: vi.fn(),
  handleCheckoutFormCallback: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@hanuja/api/lib/iyzico', () => ({
  initiate3DS: mocks.provider,
  complete3DS: mocks.provider,
  retrievePayment: mocks.provider,
  verifyWebhookSignatureV3: () => false,
  verifyCallbackSignature: mocks.provider,
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: mocks.prisma }))
vi.mock('@hanuja/api/services/card-payment.service', () => ({
  createCardPaymentService: () => ({
    handleCallback: mocks.handleCallback,
    handleCheckoutFormCallback: mocks.handleCheckoutFormCallback,
  }),
}))
vi.mock('@hanuja/api/services/card-payment-queue', () => ({ enqueueIyzicoWebhookEvent: vi.fn() }))
vi.mock('@hanuja/api/services/checkout.service', () => ({ createCheckoutService: mocks.service }))

import { POST as start } from '../../apps/web/src/app/api/payment/start/route'
import { POST as quote } from '../../apps/web/src/app/api/payment/quote/route'
import { POST as checkoutFormStart } from '../../apps/web/src/app/api/payment/checkout-form/start/route'
import { POST as checkoutFormCallback } from '../../apps/web/src/app/api/payment/checkout-form/callback/route'
import { POST as callback } from '../../apps/web/src/app/api/payment/callback/route'
import { POST as webhook } from '../../apps/web/src/app/api/webhooks/iyzico/route'
import { startCheckoutFormSchema } from '../../api/routes/card-payments'

it.each(['cardNumber', 'cardHolderName', 'cvc', 'expireMonth', 'price', 'paidPrice', 'iframeUrl'])(
  'CF start rejects client-controlled %s',
  (field) => {
    const input = {
      previewId: 'preview-1',
      startKey: 'start-key-1234567890',
      turnstileToken: 'captcha',
      acceptedDistanceSales: true,
      acceptedPreInformation: true,
      [field]: 'untrusted',
    }
    expect(startCheckoutFormSchema.safeParse(input).success).toBe(false)
  },
)

it.each(['acceptedDistanceSales', 'acceptedPreInformation'])(
  'requires separate server evidence for %s',
  (field) => {
    expect(
      startCheckoutFormSchema.safeParse({
        previewId: 'preview-1',
        startKey: 'start-key-1234567890',
        turnstileToken: 'captcha',
        acceptedDistanceSales: true,
        acceptedPreInformation: true,
        [field]: false,
      }).success,
    ).toBe(false)
  },
)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  // Eski bayrak kart satışını açmaz.
  vi.stubEnv('CARD_PAYMENTS_ENABLED', 'true')
  vi.stubEnv('IYZICO_CARD_PAYMENTS_ENABLED', 'false')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://shop.example.test')
})
afterEach(() => vi.unstubAllEnvs())

describe.each([
  ['start', start],
  ['quote', quote],
  ['checkout-form/start', checkoutFormStart],
] as const)('kart kapalıyken %s', (_, handler) => {
  it.each(['', 'tampered payload', '{"cardNumber":"4111111111111111"}'])(
    '%j gövdesini okumadan ve hiçbir yan etki olmadan reddeder',
    async (body) => {
      const response = await handler(
        new NextRequest('https://shop.example.test/api/payment', { method: 'POST', body }),
      )
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ code: 'CARD_PAYMENTS_DISABLED' })
      expect(mocks.provider).not.toHaveBeenCalled()
      expect(mocks.session).not.toHaveBeenCalled()
      expect(mocks.prisma).not.toHaveBeenCalled()
      expect(mocks.service).not.toHaveBeenCalled()
    },
  )
})

describe('kart kapalıyken başlamış ödemeler sahipsiz kalmaz', () => {
  it('CheckoutForm callback also processes server-side results without a sales flag', async () => {
    mocks.handleCheckoutFormCallback.mockResolvedValue({
      orderId: 'order-cf',
      outcome: 'succeeded',
    })
    const response = await checkoutFormCallback(
      new NextRequest('https://shop.example.test/api/payment/checkout-form/callback', {
        method: 'POST',
        body: 'token=sandbox-callback-token',
      }),
    )
    expect(response.status).toBe(200)
    expect(mocks.handleCheckoutFormCallback).toHaveBeenCalledWith('sandbox-callback-token')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('sandbox-callback-token')
  })
  it('3DS callback yine işlenir', async () => {
    mocks.handleCallback.mockResolvedValue({ orderId: 'order-1', outcome: 'succeeded' })
    const response = await callback(
      new NextRequest('https://shop.example.test/api/payment/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'status=success&paymentId=1&conversationId=hnj-1&mdStatus=1',
      }),
    )
    expect(response.status).toBe(303)
    expect(mocks.handleCallback).toHaveBeenCalledTimes(1)
  })

  it('webhook imza doğrulamasına kadar ilerler (503 değil, imzasız istek 401)', async () => {
    const response = await webhook(
      new NextRequest('https://shop.example.test/api/webhooks/iyzico', {
        method: 'POST',
        body: JSON.stringify({ iyziReferenceCode: 'r1', iyziEventType: 'THREE_DS_AUTH' }),
      }),
    )
    expect(response.status).toBe(401)
    expect(mocks.prisma).not.toHaveBeenCalled()
  })
})

it.each([start, quote])(
  'retires legacy card-data entry even when new card sales are enabled',
  async (handler) => {
    vi.stubEnv('IYZICO_CARD_PAYMENTS_ENABLED', 'true')
    expect(
      (
        await handler(
          new NextRequest('https://shop.example.test/api/payment', {
            method: 'POST',
            body: 'invalid body',
          }),
        )
      ).status,
    ).toBe(410)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.provider).not.toHaveBeenCalled()
  },
)
