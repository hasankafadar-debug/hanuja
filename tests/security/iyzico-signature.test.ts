import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyWebhookSignature } from '../../api/lib/iyzico'
const secret = 'offline-webhook-secret'
const body = '{"eventType":"PAYMENT.SUCCESS"}'
beforeEach(() => { vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('IYZICO_WEBHOOK_SECRET', secret) })
afterEach(() => vi.unstubAllEnvs())
describe('real dormant iyzico signature verifier', () => {
  it.each(['', 'x', 'a'.repeat(64), 'malformed-signature'])('rejects %j without throwing', signature => {
    expect(verifyWebhookSignature(signature, body)).toBe(false)
  })
  it('preserves valid provider signatures and rejects altered bodies', () => {
    const signature = createHmac('sha1', secret).update(body).digest('base64')
    expect(verifyWebhookSignature(signature, body)).toBe(true)
    expect(verifyWebhookSignature(signature, `${body} `)).toBe(false)
  })
  it('fails closed without a secret in production', () => {
    vi.stubEnv('IYZICO_WEBHOOK_SECRET', '')
    expect(verifyWebhookSignature('', body)).toBe(false)
  })
})
