import { describe, expect, it } from 'vitest'
import {
  assertPaymentMethodEnabled,
  isCardPaymentsEnabled,
} from '../../api/lib/payment-capabilities'

describe('payment capabilities', () => {
  it('fails closed for card payments in production when the flag is absent', () => {
    expect(isCardPaymentsEnabled({ NODE_ENV: 'production' })).toBe(false)
  })

  it('keeps card payments disabled in local development too', () => {
    expect(isCardPaymentsEnabled({ NODE_ENV: 'development' })).toBe(false)
    expect(
      isCardPaymentsEnabled({
        NODE_ENV: 'development',
        CARD_PAYMENTS_ENABLED: 'false',
      }),
    ).toBe(false)
  })

  it('allows EFT but rejects forged card checkout while disabled', () => {
    const env = { NODE_ENV: 'production', CARD_PAYMENTS_ENABLED: 'false' }
    expect(() => assertPaymentMethodEnabled('eft', env)).not.toThrow()
    expect(() => assertPaymentMethodEnabled('card', env)).toThrowError(
      expect.objectContaining({
        code: 'CARD_PAYMENTS_DISABLED',
        statusCode: 503,
      }),
    )
  })

  it('does not allow the legacy flag to reopen card sales', () => {
    const env = { NODE_ENV: 'production', CARD_PAYMENTS_ENABLED: 'true' }
    expect(isCardPaymentsEnabled(env)).toBe(false)
    expect(() => assertPaymentMethodEnabled('card', env)).toThrowError(
      expect.objectContaining({
        code: 'CARD_PAYMENTS_DISABLED',
        statusCode: 503,
      }),
    )
  })
})
