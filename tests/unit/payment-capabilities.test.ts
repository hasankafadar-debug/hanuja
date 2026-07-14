import { describe, expect, it } from 'vitest'
import {
  assertPaymentMethodEnabled,
  isCardPaymentsEnabled,
} from '../../api/lib/payment-capabilities'

describe('payment capabilities', () => {
  it('fails closed for card payments in production when the flag is absent', () => {
    expect(isCardPaymentsEnabled({ NODE_ENV: 'production' })).toBe(false)
  })

  it('keeps local development backwards compatible unless explicitly disabled', () => {
    expect(isCardPaymentsEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(
      isCardPaymentsEnabled({ NODE_ENV: 'development', CARD_PAYMENTS_ENABLED: 'false' }),
    ).toBe(false)
  })

  it('allows EFT but rejects forged card checkout while disabled', () => {
    const env = { NODE_ENV: 'production', CARD_PAYMENTS_ENABLED: 'false' }
    expect(() => assertPaymentMethodEnabled('eft', env)).not.toThrow()
    expect(() => assertPaymentMethodEnabled('card', env)).toThrowError(
      expect.objectContaining({ code: 'CARD_PAYMENTS_DISABLED', statusCode: 503 }),
    )
  })

  it('enables card payments only after an explicit production opt-in', () => {
    const env = { NODE_ENV: 'production', CARD_PAYMENTS_ENABLED: 'true' }
    expect(isCardPaymentsEnabled(env)).toBe(true)
    expect(() => assertPaymentMethodEnabled('card', env)).not.toThrow()
  })
})
