/**
 * api/services/cookie-consent.service.ts — the server never trusts the client's flags:
 * accept/reject come from the button, categories with no real cookie are always false,
 * unknown consent ids are never adopted, and revoking a grant is recorded as a withdrawal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { COOKIE_POLICY_VERSION } from '@hanuja/api/lib/cookie-policy'
import {
  CookieConsentError,
  createCookieConsentService,
  deriveCookieConsentAction,
  resolveCookieConsentFlags,
} from '@hanuja/api/services/cookie-consent.service'

const OFF = { functional: false, analytics: false, marketing: false }
const EXISTING_ID = '4f9c2b1e-8d3a-4c6b-9e1f-2a7d5c8b3e10'

function fakePrisma(previous: Record<string, unknown> | null = null) {
  const findFirst = vi.fn().mockResolvedValue(previous)
  const create = vi.fn().mockResolvedValue({})
  const prisma = { cookieConsentRecord: { findFirst, create } } as unknown as PrismaClient
  return { prisma, findFirst, create }
}

describe('resolveCookieConsentFlags', () => {
  it('derives accept and reject from the button, not the payload', () => {
    expect(resolveCookieConsentFlags('accept_all', OFF, ['analytics', 'marketing'])).toEqual({
      functional: false,
      analytics: true,
      marketing: true,
    })
    expect(
      resolveCookieConsentFlags('reject_all', { functional: true, analytics: true, marketing: true }, ['analytics']),
    ).toEqual(OFF)
  })

  it('never stores consent for a category with no real cookie', () => {
    expect(
      resolveCookieConsentFlags('save', { functional: true, analytics: true, marketing: true }, ['analytics']),
    ).toEqual({ functional: false, analytics: true, marketing: false })
  })
})

describe('deriveCookieConsentAction', () => {
  it('maps buttons to actions when nothing is revoked', () => {
    expect(deriveCookieConsentAction('accept_all', null, { ...OFF, analytics: true })).toBe('accept_all')
    expect(deriveCookieConsentAction('reject_all', null, OFF)).toBe('reject_all')
    expect(deriveCookieConsentAction('save', null, { ...OFF, analytics: true })).toBe('custom')
  })

  it('records revoking a previous grant as a withdrawal, whichever button was used', () => {
    const previous = { ...OFF, analytics: true, marketing: true }
    expect(deriveCookieConsentAction('reject_all', previous, OFF)).toBe('withdraw')
    expect(deriveCookieConsentAction('save', previous, { ...OFF, analytics: true })).toBe('withdraw')
    expect(deriveCookieConsentAction('accept_all', { ...OFF, analytics: true }, { ...OFF, analytics: true })).toBe(
      'accept_all',
    )
  })
})

describe('createCookieConsentService.record', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses to record anything while the site only uses necessary cookies', async () => {
    const { prisma, create } = fakePrisma()
    const service = createCookieConsentService(prisma)
    await expect(
      service.record({ decision: 'accept_all', policyVersion: COOKIE_POLICY_VERSION, ...OFF, userId: null }),
    ).rejects.toMatchObject({ code: 'CONSENT_NOT_REQUIRED' })
    expect(create).not.toHaveBeenCalled()
  })

  describe('in consent mode', () => {
    beforeEach(() => {
      vi.stubEnv('NEXT_PUBLIC_COOKIE_CONSENT_E2E_FIXTURE', '1')
    })

    it('rejects a decision made against an outdated policy text', async () => {
      const { prisma, create } = fakePrisma()
      const error = await createCookieConsentService(prisma)
        .record({ decision: 'accept_all', policyVersion: '2026-01-01-v1', ...OFF, userId: null })
        .catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(CookieConsentError)
      expect((error as CookieConsentError).code).toBe('POLICY_VERSION_MISMATCH')
      expect(create).not.toHaveBeenCalled()
    })

    it('issues a new consent id instead of adopting an unknown one', async () => {
      const { prisma, create } = fakePrisma(null)
      const result = await createCookieConsentService(prisma).record({
        decision: 'accept_all',
        consentId: EXISTING_ID,
        policyVersion: COOKIE_POLICY_VERSION,
        ...OFF,
        userId: 'user-1',
      })
      expect(result.consentId).not.toBe(EXISTING_ID)
      expect(result).toMatchObject({ action: 'accept_all', necessary: true, analytics: true, marketing: true })
      expect(create).toHaveBeenCalledWith({
        data: {
          consentId: result.consentId,
          userId: 'user-1',
          policyVersion: COOKIE_POLICY_VERSION,
          necessary: true,
          functional: false,
          analytics: true,
          marketing: true,
          action: 'accept_all',
        },
      })
    })

    it('appends a withdrawal to an existing chain under the same version', async () => {
      const { prisma, create } = fakePrisma({
        consentId: EXISTING_ID,
        policyVersion: COOKIE_POLICY_VERSION,
        functional: false,
        analytics: true,
        marketing: false,
      })
      const result = await createCookieConsentService(prisma).record({
        decision: 'reject_all',
        consentId: EXISTING_ID,
        policyVersion: COOKIE_POLICY_VERSION,
        ...OFF,
        userId: null,
      })
      expect(result).toMatchObject({ consentId: EXISTING_ID, action: 'withdraw', analytics: false })
      expect(create).toHaveBeenCalledTimes(1)
    })

    it('does not call it a withdrawal when the earlier grant was under an older version', async () => {
      const { prisma } = fakePrisma({
        consentId: EXISTING_ID,
        policyVersion: '2026-01-01-v1',
        functional: false,
        analytics: true,
        marketing: true,
      })
      const result = await createCookieConsentService(prisma).record({
        decision: 'reject_all',
        consentId: EXISTING_ID,
        policyVersion: COOKIE_POLICY_VERSION,
        ...OFF,
        userId: null,
      })
      expect(result).toMatchObject({ consentId: EXISTING_ID, action: 'reject_all' })
    })
  })
})
