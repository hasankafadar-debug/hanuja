import { describe, expect, it } from 'vitest'
import {
  CSRF_TOKEN_BYTES,
  generateCsrfToken,
  verifyCsrfToken,
} from '../../packages/security/src/csrf'

describe('CSRF token helpers', () => {
  it('generates independent cryptographically random hexadecimal tokens', () => {
    const first = generateCsrfToken()
    const second = generateCsrfToken()

    expect(first).toMatch(/^[0-9a-f]+$/)
    expect(first).toHaveLength(CSRF_TOKEN_BYTES * 2)
    expect(second).not.toBe(first)
  })

  it('accepts only matching non-empty tokens', () => {
    const token = generateCsrfToken()
    const changedToken = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`

    expect(verifyCsrfToken(token, token)).toBe(true)
    expect(verifyCsrfToken(token, changedToken)).toBe(false)
    expect(verifyCsrfToken(undefined, token)).toBe(false)
    expect(verifyCsrfToken(token, undefined)).toBe(false)
  })
})
