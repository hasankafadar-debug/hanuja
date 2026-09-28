import {
  isCookieConsentE2EFixtureEnabled,
  OPTIONAL_COOKIE_CATEGORIES,
  type OptionalCookieCategory,
} from '@hanuja/api/lib/cookie-policy'
import type { ConsentFlags } from './state'

/**
 * Every non-necessary script the storefront may load. A script is only injected after
 * its category is granted, never loaded first and then blocked. Each one must list the
 * first-party cookies and storage keys it creates (also present in the cookie
 * inventory), so withdrawal can remove them — tests/unit/cookie-consent-state.test.ts.
 */
export interface ConsentScript {
  id: string
  category: OptionalCookieCategory
  src: string
  cleanup: { cookies: readonly string[]; storageKeys: readonly string[] }
}

const E2E_FIXTURE_SCRIPTS: readonly ConsentScript[] = [
  {
    id: 'e2e-analytics',
    category: 'analytics',
    src: '/__cookie-consent-fixture/analytics.js',
    cleanup: { cookies: ['hanuja_e2e_analytics'], storageKeys: ['hanuja_e2e_analytics'] },
  },
  {
    id: 'e2e-marketing',
    category: 'marketing',
    src: '/__cookie-consent-fixture/marketing.js',
    cleanup: { cookies: ['hanuja_e2e_marketing'], storageKeys: [] },
  },
]

export function getConsentScripts(): readonly ConsentScript[] {
  return isCookieConsentE2EFixtureEnabled() ? E2E_FIXTURE_SCRIPTS : []
}

export function resolveScriptsToLoad(
  flags: ConsentFlags,
  scripts: readonly ConsentScript[] = getConsentScripts(),
): ConsentScript[] {
  return scripts.filter((script) => flags[script.category])
}

export interface WithdrawalCleanup {
  cookies: string[]
  storageKeys: string[]
  scriptIds: string[]
}

export function computeWithdrawalCleanup(
  previous: ConsentFlags,
  next: ConsentFlags,
  scripts: readonly ConsentScript[] = getConsentScripts(),
): WithdrawalCleanup {
  const withdrawn = OPTIONAL_COOKIE_CATEGORIES.filter((category) => previous[category] && !next[category])
  const affected = scripts.filter((script) => withdrawn.includes(script.category))
  return {
    cookies: [...new Set(affected.flatMap((script) => script.cleanup.cookies))],
    storageKeys: [...new Set(affected.flatMap((script) => script.cleanup.storageKeys))],
    scriptIds: affected.map((script) => script.id),
  }
}
