import { describe, expect, it } from 'vitest'
import {
  MIN_RUNTIME_SECRET_LENGTH,
  requireRuntimeSecret,
  shouldSkipEnvValidation,
} from '../../packages/config/src/env'

describe('runtime secret guards', () => {
  it('rejects a missing secret without including a value in the error', () => {
    expect(() => requireRuntimeSecret('BETTER_AUTH_SECRET', undefined)).toThrow(
      'BETTER_AUTH_SECRET must be configured',
    )
  })

  it('rejects a secret shorter than the required minimum', () => {
    expect(() =>
      requireRuntimeSecret('BETTER_AUTH_SECRET', 'a'.repeat(MIN_RUNTIME_SECRET_LENGTH - 1)),
    ).toThrow(`BETTER_AUTH_SECRET must be at least ${MIN_RUNTIME_SECRET_LENGTH} characters`)
  })

  it.each(['change-me-in-production', 'turnstile-secret-not-configured'])(
    'rejects the known placeholder %s',
    (placeholder) => {
      expect(() => requireRuntimeSecret('TEST_SECRET', placeholder)).toThrow(
        'TEST_SECRET must not use a placeholder value',
      )
    },
  )

  it('returns a sufficiently long non-placeholder secret', () => {
    const secret = 'x'.repeat(64)
    expect(requireRuntimeSecret('BETTER_AUTH_SECRET', secret)).toBe(secret)
  })

  it('never skips validation in production, even when requested', () => {
    expect(shouldSkipEnvValidation({ NODE_ENV: 'production', SKIP_ENV_VALIDATION: 'true' })).toBe(
      false,
    )
  })

  it('preserves explicit validation skips for test and build contexts outside production', () => {
    expect(shouldSkipEnvValidation({ NODE_ENV: 'test', SKIP_ENV_VALIDATION: 'true' })).toBe(true)
    expect(shouldSkipEnvValidation({ NODE_ENV: 'development', SKIP_ENV_VALIDATION: 'true' })).toBe(
      true,
    )
  })
})
