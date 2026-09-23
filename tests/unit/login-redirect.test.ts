import { describe, expect, it } from 'vitest'
import { safeInternalPath } from '../../apps/web/src/lib/login-redirect'

const REJECTED = [
  'https://evil.com',
  'http://evil.com/hesabim',
  '//evil.com',
  '/\\evil.com',
  '\\\\evil.com',
  '/%2F%2Fevil.com',
  '/%5Cevil.com',
  '/%2F%5Cevil.com',
  '%2F%2Fevil.com',
  'javascript:alert(1)',
  '/%E0%A4%A',
  '/a/..//evil.com',
  '/a/../..//evil.com',
  '/a/%2e%2e//evil.com',
  '/a/%2E%2E/%2F%2Fevil.com',
  '/./%2F/evil.com',
  '/a/.%2e//evil.com',
  '/a/..',
  ' /hesabim',
  '/hesabim\n',
  '',
]

describe('safeInternalPath', () => {
  it.each(REJECTED)('falls back for %j', (value) => {
    expect(safeInternalPath(value)).toBe('/hesabim')
  })

  it('falls back for non-string input', () => {
    expect(safeInternalPath(null)).toBe('/hesabim')
    expect(safeInternalPath(undefined)).toBe('/hesabim')
    expect(safeInternalPath(42)).toBe('/hesabim')
  })

  it('uses the given fallback', () => {
    expect(safeInternalPath('//evil.com', '/')).toBe('/')
  })

  it.each([
    '/urun/x?soru=1',
    '/urun/%C3%A7ay-bardagi',
    '/hesabim/sorularim/abc123',
    '/api/orders/o-1/documents/contracts/distance-sales?goruntule=1',
    '/.well-known/x',
    '/siparis#destek',
  ])('keeps the in-app path %j unchanged', (value) => {
    expect(safeInternalPath(value)).toBe(value)
  })

  it('never returns a protocol-relative or backslash path', () => {
    for (const value of [...REJECTED, '/urun/x?soru=1', '/a/b/../c']) {
      const result = safeInternalPath(value)
      expect(result.startsWith('/')).toBe(true)
      expect(result.startsWith('//')).toBe(false)
      expect(result.includes('\\')).toBe(false)
    }
  })
})
