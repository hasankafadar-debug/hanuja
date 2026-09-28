/**
 * Storefront cookie consent client logic — apps/web/src/lib/cookie-consent/{state,scripts}.ts.
 * Anything unreadable must behave as "no consent", and withdrawal must know exactly which
 * scripts, cookies and storage keys to remove.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COOKIE_POLICY_VERSION, getCookieInventory } from '@hanuja/api/lib/cookie-policy'
import {
  isNoticeAcknowledged,
  NO_OPTIONAL_CONSENT,
  parseStoredConsent,
  toConsentFlags,
} from '../../apps/web/src/lib/cookie-consent/state'
import {
  computeWithdrawalCleanup,
  getConsentScripts,
  resolveScriptsToLoad,
  type ConsentScript,
} from '../../apps/web/src/lib/cookie-consent/scripts'

const CONSENT_ID = '4f9c2b1e-8d3a-4c6b-9e1f-2a7d5c8b3e10'

function stored(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    consentId: CONSENT_ID,
    policyVersion: COOKIE_POLICY_VERSION,
    functional: false,
    analytics: true,
    marketing: false,
    decidedAt: '2026-09-28T10:00:00.000Z',
    ...overrides,
  })
}

const SCRIPTS: ConsentScript[] = [
  { id: 'a', category: 'analytics', src: '/a.js', cleanup: { cookies: ['_a', '_shared'], storageKeys: ['a-key'] } },
  { id: 'm', category: 'marketing', src: '/m.js', cleanup: { cookies: ['_m', '_shared'], storageKeys: [] } },
]

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseStoredConsent', () => {
  it('treats missing, malformed or invalid values as no decision', () => {
    expect(parseStoredConsent(null)).toBeNull()
    expect(parseStoredConsent('not json')).toBeNull()
    expect(parseStoredConsent(stored({ analytics: 'yes' }))).toBeNull()
    expect(parseStoredConsent(stored({ consentId: 'not-a-uuid' }))).toBeNull()
  })

  it('ignores a decision made under an older policy version', () => {
    expect(parseStoredConsent(stored({ policyVersion: '2026-01-01-v1' }))).toBeNull()
  })

  it('reads a valid decision for the current version', () => {
    const consent = parseStoredConsent(stored())
    expect(consent?.consentId).toBe(CONSENT_ID)
    expect(toConsentFlags(consent)).toEqual({ functional: false, analytics: true, marketing: false })
  })

  it('maps no decision to every optional category off', () => {
    expect(toConsentFlags(null)).toEqual(NO_OPTIONAL_CONSENT)
  })
})

describe('isNoticeAcknowledged', () => {
  it('only accepts the current version', () => {
    expect(isNoticeAcknowledged(COOKIE_POLICY_VERSION)).toBe(true)
    expect(isNoticeAcknowledged('2026-01-01-v1')).toBe(false)
    expect(isNoticeAcknowledged(null)).toBe(false)
  })
})

describe('script gating', () => {
  it('loads nothing without consent and only granted categories otherwise', () => {
    expect(resolveScriptsToLoad(NO_OPTIONAL_CONSENT, SCRIPTS)).toEqual([])
    expect(resolveScriptsToLoad({ ...NO_OPTIONAL_CONSENT, analytics: true }, SCRIPTS).map((s) => s.id)).toEqual(['a'])
  })

  it('has no optional script in production', () => {
    expect(getConsentScripts()).toEqual([])
  })
})

describe('computeWithdrawalCleanup', () => {
  it('cleans up only the withdrawn categories', () => {
    const cleanup = computeWithdrawalCleanup(
      { functional: false, analytics: true, marketing: true },
      { functional: false, analytics: false, marketing: true },
      SCRIPTS,
    )
    expect(cleanup).toEqual({ cookies: ['_a', '_shared'], storageKeys: ['a-key'], scriptIds: ['a'] })
  })

  it('does nothing when nothing is withdrawn', () => {
    const cleanup = computeWithdrawalCleanup(NO_OPTIONAL_CONSENT, { ...NO_OPTIONAL_CONSENT, analytics: true }, SCRIPTS)
    expect(cleanup).toEqual({ cookies: [], storageKeys: [], scriptIds: [] })
  })
})

describe('consent scripts and inventory stay in sync', () => {
  it('lists every cookie a consent script creates in the inventory under the same category', () => {
    vi.stubEnv('NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE', '1')
    const inventory = getCookieInventory()
    const scripts = getConsentScripts()
    expect(scripts.length).toBeGreaterThan(0)
    for (const script of scripts) {
      for (const cookie of script.cleanup.cookies) {
        const entry = inventory.find((item) => new RegExp(item.namePattern).test(cookie))
        expect(entry, `${script.id} → ${cookie}`).toBeDefined()
        expect(entry?.category).toBe(script.category)
      }
    }
  })
})
