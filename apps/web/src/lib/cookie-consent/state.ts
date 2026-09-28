import { z } from 'zod'
import { COOKIE_POLICY_VERSION, type OptionalCookieCategory } from '@hanuja/api/lib/cookie-policy'

export type ConsentFlags = Record<OptionalCookieCategory, boolean>

export const NO_OPTIONAL_CONSENT: ConsentFlags = { functional: false, analytics: false, marketing: false }

const storedConsentSchema = z.object({
  consentId: z.string().uuid().nullable(),
  policyVersion: z.string(),
  functional: z.boolean(),
  analytics: z.boolean(),
  marketing: z.boolean(),
  decidedAt: z.string(),
})

export type StoredConsent = z.infer<typeof storedConsentSchema>

/**
 * Anything unreadable, malformed or from an older policy version counts as "no decision",
 * so optional scripts stay off and the visitor is asked again.
 */
export function parseStoredConsent(raw: string | null, currentVersion = COOKIE_POLICY_VERSION): StoredConsent | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = storedConsentSchema.safeParse(value)
  if (!parsed.success || parsed.data.policyVersion !== currentVersion) return null
  return parsed.data
}

export function isNoticeAcknowledged(raw: string | null, currentVersion = COOKIE_POLICY_VERSION): boolean {
  return raw === currentVersion
}

export function toConsentFlags(consent: StoredConsent | null): ConsentFlags {
  if (!consent) return NO_OPTIONAL_CONSENT
  return { functional: consent.functional, analytics: consent.analytics, marketing: consent.marketing }
}
