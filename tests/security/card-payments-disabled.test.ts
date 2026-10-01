import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ session: vi.fn(), provider: vi.fn(), prisma: vi.fn(), service: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@hanuja/api/lib/iyzico', () => ({ initiate3DS: mocks.provider, complete3DS: mocks.provider, retrievePayment: mocks.provider, verifyWebhookSignature: mocks.provider }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: mocks.prisma }))
vi.mock('@hanuja/api/services/payment.service', () => ({ createPaymentService: mocks.service }))
vi.mock('@hanuja/api/services/checkout.service', () => ({ createCheckoutService: mocks.service }))
import { POST as start } from '../../apps/web/src/app/api/payment/start/route'
import { POST as callback } from '../../apps/web/src/app/api/payment/callback/route'
import { POST as webhook } from '../../apps/web/src/app/api/webhooks/iyzico/route'
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('CARD_PAYMENTS_ENABLED', 'true') })
afterEach(() => vi.unstubAllEnvs())
describe.each([['start', start], ['callback', callback], ['webhook', webhook]] as const)('disabled card %s', (_, handler) => {
  it.each(['', 'tampered payload', '{"paidPrice":"0.01","eventType":"PAYMENT.SUCCESS"}'])('rejects %j before parsing or any external effect', async body => {
    const response = await handler(new NextRequest('https://shop.example.test/api/payment', { method: 'POST', body }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'CARD_PAYMENTS_DISABLED' })
    expect(mocks.provider).not.toHaveBeenCalled()
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mocks.prisma).not.toHaveBeenCalled()
    expect(mocks.service).not.toHaveBeenCalled()
  })
})
