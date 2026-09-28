/**
 * Cookie inventory contract — api/lib/cookie-policy.ts.
 *
 * The fingerprint test is the durable guard: any change to the inventory (a new cookie,
 * category, purpose or vendor) fails here until COOKIE_POLICY_VERSION is bumped, because a
 * new version is what re-shows the notice and invalidates stored consent.
 * docs/08-legal/cookie-policy-notes.md
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COOKIE_CONSENT_STORAGE_KEY,
  COOKIE_NOTICE_STORAGE_KEY,
  COOKIE_POLICY_FINGERPRINT,
  COOKIE_POLICY_UPDATED_AT,
  COOKIE_POLICY_VERSION,
  EXPECTED_EXTERNAL_HOSTS,
  getActiveOptionalCategories,
  getBaseCookieInventory,
  getCookieInventory,
  getCookieNoticeMode,
  isExpectedExternalHost,
} from '@hanuja/api/lib/cookie-policy'
import { CSRF_COOKIE_NAME, CSRF_MIRROR_COOKIE_NAME } from '../../packages/security/src/csrf'

const MIDDLEWARE = new URL('../../apps/web/src/middleware.ts', import.meta.url)
const E2E_SPEC = new URL('../e2e/storefront/cookie-consent.e2e.ts', import.meta.url)
const POLICY_PAGE = new URL('../../apps/web/src/app/(storefront)/(legal)/cerez-politikasi/page.tsx', import.meta.url)

function fingerprint(): string {
  return createHash('sha256').update(JSON.stringify(getBaseCookieInventory())).digest('hex')
}

function matches(name: string): boolean {
  return getBaseCookieInventory().some((entry) => new RegExp(entry.namePattern).test(name))
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cookie policy version', () => {
  it('uses the dated version format and matches the published date', () => {
    expect(COOKIE_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/)
    const [year, month, day] = COOKIE_POLICY_VERSION.split('-')
    expect(COOKIE_POLICY_UPDATED_AT).toBe(`${day}.${month}.${year}`)
  })

  it('is bumped whenever the inventory changes', () => {
    const actual = fingerprint()
    expect(
      actual,
      `Çerez envanteri değişti. COOKIE_POLICY_VERSION'ı yükseltin (yeni rıza gerekebilir) ve ` +
        `COOKIE_POLICY_FINGERPRINT değerini "${actual}" yapın.`,
    ).toBe(COOKIE_POLICY_FINGERPRINT)
  })
})

describe('cookie inventory', () => {
  it('has complete, unique entries whose pattern matches their own name', () => {
    const keys = new Set<string>()
    for (const entry of getBaseCookieInventory()) {
      for (const field of ['key', 'provider', 'domain', 'purpose', 'duration', 'legalBasis', 'trigger'] as const) {
        expect(entry[field].trim(), `${entry.key}.${field}`).not.toBe('')
      }
      expect(keys.has(entry.key), `duplicate ${entry.key}`).toBe(false)
      keys.add(entry.key)
      expect(new RegExp(entry.namePattern).test(entry.key), entry.key).toBe(true)
    }
  })

  it('lists the CSRF cookies the middleware issues', () => {
    expect(matches(CSRF_COOKIE_NAME)).toBe(true)
    expect(matches(CSRF_MIRROR_COOKIE_NAME)).toBe(true)
  })

  it('covers every Better Auth session cookie name the middleware accepts, with and without __Secure-', async () => {
    const source = await readFile(MIDDLEWARE, 'utf8')
    for (const name of ['better-auth.session_token', '__Secure-better-auth.session_token']) {
      expect(source).toContain(`'${name}'`)
      expect(matches(name), name).toBe(true)
    }
    expect(matches('__Secure-better-auth.session_data')).toBe(true)
    expect(matches('better-auth.session_data.0')).toBe(true)
    expect(matches('__Secure-better-auth.state')).toBe(true)
  })

  it('lists the notice and consent storage keys', () => {
    expect(matches(COOKIE_NOTICE_STORAGE_KEY)).toBe(true)
    expect(matches(COOKIE_CONSENT_STORAGE_KEY)).toBe(true)
  })

  it('does not match unrelated names', () => {
    expect(matches('_ga')).toBe(false)
    expect(matches('better-auth.session_tokenx')).toBe(false)
  })
})

describe('notice mode', () => {
  it('is info mode while every real entry is strictly necessary', () => {
    expect(getBaseCookieInventory().every((entry) => entry.category === 'necessary')).toBe(true)
    expect(getActiveOptionalCategories()).toEqual([])
    expect(getCookieNoticeMode()).toBe('info')
  })

  it('switches to consent mode as soon as a non-necessary entry exists', () => {
    vi.stubEnv('NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE', '1')
    expect(getActiveOptionalCategories()).toEqual(['analytics', 'marketing'])
    expect(getCookieNoticeMode()).toBe('consent')
    expect(getCookieInventory().length).toBeGreaterThan(getBaseCookieInventory().length)
  })

  it('never publishes the E2E fixture entries on the policy page', async () => {
    const source = await readFile(POLICY_PAGE, 'utf8')
    expect(source).toContain('getBaseCookieInventory()')
    expect(source).not.toContain('getCookieInventory()')
  })
})

describe('expected external hosts', () => {
  it('stays identical to the E2E mirror list', async () => {
    const spec = await readFile(E2E_SPEC, 'utf8')
    const mirror = /const EXPECTED_EXTERNAL_HOSTS = \[([^\]]*)\]/.exec(spec)?.[1] ?? ''
    const mirrored = [...mirror.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(mirrored).toEqual(EXPECTED_EXTERNAL_HOSTS.map(({ host }) => host))
  })

  it('accepts listed hosts and wildcard subdomains only', () => {
    expect(isExpectedExternalHost('challenges.cloudflare.com')).toBe(true)
    expect(isExpectedExternalHost('brunhild.challenges.cloudflare.com')).toBe(true)
    expect(isExpectedExternalHost('abc123.r2.cloudflarestorage.com')).toBe(true)
    expect(isExpectedExternalHost('www.googletagmanager.com')).toBe(false)
    expect(isExpectedExternalHost('evil-r2.cloudflarestorage.com.example')).toBe(false)
  })
})
