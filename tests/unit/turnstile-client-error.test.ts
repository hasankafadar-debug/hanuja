import { describe, expect, it } from 'vitest'
import {
  getTurnstileClientErrorMessage,
  isDatabaseUnavailableError,
} from '../../packages/security/src/turnstile-error'

describe('Turnstile client error mapping', () => {
  it.each([
    'TURNSTILE_REQUIRED',
    'TURNSTILE_INVALID',
    'TURNSTILE_UNAVAILABLE',
    'TURNSTILE_MISCONFIGURED',
  ])('maps the explicit %s contract', (code) => {
    expect(getTurnstileClientErrorMessage({ code })).toBeTruthy()
  })

  it('does not infer Turnstile failures from an HTTP status', () => {
    expect(getTurnstileClientErrorMessage({ status: 503 })).toBeNull()
  })

  it('only identifies the explicit database error code', () => {
    expect(isDatabaseUnavailableError({ code: 'DATABASE_UNAVAILABLE', status: 503 })).toBe(true)
    expect(isDatabaseUnavailableError({ message: 'database failed', status: 503 })).toBe(false)
    expect(
      isDatabaseUnavailableError({
        code: 'TURNSTILE_UNAVAILABLE',
        status: 503,
      }),
    ).toBe(false)
  })
})
