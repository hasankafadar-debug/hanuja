import { randomUUID } from 'node:crypto'
import type { CookieConsentAction, PrismaClient } from '@prisma/client'
import {
  COOKIE_POLICY_VERSION,
  getActiveOptionalCategories,
  getCookieNoticeMode,
  OPTIONAL_COOKIE_CATEGORIES,
  type OptionalCookieCategory,
} from '../lib/cookie-policy'

/** Which control the visitor used. The stored action is derived on the server. */
export type CookieConsentDecision = 'accept_all' | 'reject_all' | 'save'

export type CookieConsentFlags = Record<OptionalCookieCategory, boolean>

export interface RecordCookieConsentInput {
  decision: CookieConsentDecision
  consentId?: string | null | undefined
  policyVersion: string
  functional: boolean
  analytics: boolean
  marketing: boolean
  userId: string | null
}

export interface RecordCookieConsentResult {
  consentId: string
  policyVersion: string
  action: CookieConsentAction
  necessary: true
  functional: boolean
  analytics: boolean
  marketing: boolean
}

export type CookieConsentErrorCode = 'CONSENT_NOT_REQUIRED' | 'POLICY_VERSION_MISMATCH'

export class CookieConsentError extends Error {
  constructor(
    public readonly code: CookieConsentErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CookieConsentError'
  }
}

/**
 * Accept/reject flags come from the button, not the payload, and a category with no
 * real cookie behind it is always stored as false — the client cannot record consent
 * for something the site does not use.
 */
export function resolveCookieConsentFlags(
  decision: CookieConsentDecision,
  requested: CookieConsentFlags,
  activeCategories: readonly OptionalCookieCategory[],
): CookieConsentFlags {
  const flags = {} as CookieConsentFlags
  for (const category of OPTIONAL_COOKIE_CATEGORIES) {
    const active = activeCategories.includes(category)
    if (!active) flags[category] = false
    else if (decision === 'accept_all') flags[category] = true
    else if (decision === 'reject_all') flags[category] = false
    else flags[category] = requested[category] === true
  }
  return flags
}

/**
 * Revoking any category that was granted under the same policy version is a withdrawal,
 * whichever button was used. Grants under an older version were already voided by the
 * version change, so turning them off now is a fresh decision, not a withdrawal.
 */
export function deriveCookieConsentAction(
  decision: CookieConsentDecision,
  previous: CookieConsentFlags | null,
  next: CookieConsentFlags,
): CookieConsentAction {
  if (previous && OPTIONAL_COOKIE_CATEGORIES.some((category) => previous[category] && !next[category])) {
    return 'withdraw'
  }
  if (decision === 'accept_all') return 'accept_all'
  if (decision === 'reject_all') return 'reject_all'
  return 'custom'
}

export function createCookieConsentService(prisma: PrismaClient) {
  return {
    async record(input: RecordCookieConsentInput): Promise<RecordCookieConsentResult> {
      if (getCookieNoticeMode() !== 'consent') {
        throw new CookieConsentError(
          'CONSENT_NOT_REQUIRED',
          'Sitede rıza gerektiren çerez kullanılmadığı için tercih kaydı alınmıyor.',
        )
      }
      if (input.policyVersion !== COOKIE_POLICY_VERSION) {
        throw new CookieConsentError(
          'POLICY_VERSION_MISMATCH',
          'Çerez metni güncellendi. Sayfayı yenileyip tercihinizi yeniden yapın.',
        )
      }

      const flags = resolveCookieConsentFlags(input.decision, input, getActiveOptionalCategories())

      // An unknown id is never adopted: the client cannot attach its rows to a chain it did not create.
      const previousRow = input.consentId
        ? await prisma.cookieConsentRecord.findFirst({
            where: { consentId: input.consentId },
            orderBy: { createdAt: 'desc' },
            select: { consentId: true, policyVersion: true, functional: true, analytics: true, marketing: true },
          })
        : null
      const consentId = previousRow?.consentId ?? randomUUID()
      const previousFlags =
        previousRow && previousRow.policyVersion === COOKIE_POLICY_VERSION
          ? { functional: previousRow.functional, analytics: previousRow.analytics, marketing: previousRow.marketing }
          : null

      const action = deriveCookieConsentAction(input.decision, previousFlags, flags)
      await prisma.cookieConsentRecord.create({
        data: {
          consentId,
          userId: input.userId,
          policyVersion: COOKIE_POLICY_VERSION,
          necessary: true,
          ...flags,
          action,
        },
      })

      return { consentId, policyVersion: COOKIE_POLICY_VERSION, action, necessary: true, ...flags }
    },
  }
}
