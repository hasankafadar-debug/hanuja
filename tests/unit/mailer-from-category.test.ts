import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveFromAddress } from '../../api/lib/mailer'
import { PLATFORM_LEGAL_INFO } from '../../api/lib/platform-info'

const ENV_KEYS = [
  'EMAIL_FROM_NOREPLY',
  'EMAIL_FROM_FATURA',
  'EMAIL_FROM_KAMPANYA',
  'SMTP_FROM',
] as const

const HARDCODED_DEFAULT = `Hanuja <${PLATFORM_LEGAL_INFO.transactionalEmail}>`

describe('resolveFromAddress', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('uses the category-specific env var when set', () => {
    process.env['EMAIL_FROM_FATURA'] = 'Hanuja Fatura <fatura@hanuja.com.tr>'
    process.env['SMTP_FROM'] = 'Hanuja <smtp@hanuja.com.tr>'

    expect(resolveFromAddress('fatura')).toBe('Hanuja Fatura <fatura@hanuja.com.tr>')
  })

  it('resolves each category to its own env var', () => {
    process.env['EMAIL_FROM_NOREPLY'] = 'noreply-env'
    process.env['EMAIL_FROM_FATURA'] = 'fatura-env'
    process.env['EMAIL_FROM_KAMPANYA'] = 'kampanya-env'

    expect(resolveFromAddress('noreply')).toBe('noreply-env')
    expect(resolveFromAddress('fatura')).toBe('fatura-env')
    expect(resolveFromAddress('kampanya')).toBe('kampanya-env')
  })

  it('falls back to SMTP_FROM when the category env var is unset', () => {
    process.env['SMTP_FROM'] = 'Hanuja <smtp@hanuja.com.tr>'

    expect(resolveFromAddress('noreply')).toBe('Hanuja <smtp@hanuja.com.tr>')
    expect(resolveFromAddress('fatura')).toBe('Hanuja <smtp@hanuja.com.tr>')
    expect(resolveFromAddress('kampanya')).toBe('Hanuja <smtp@hanuja.com.tr>')
  })

  it('falls back to the hardcoded default when both are unset', () => {
    expect(resolveFromAddress('noreply')).toBe(HARDCODED_DEFAULT)
    expect(resolveFromAddress('fatura')).toBe(HARDCODED_DEFAULT)
    expect(resolveFromAddress('kampanya')).toBe(HARDCODED_DEFAULT)
  })
})
