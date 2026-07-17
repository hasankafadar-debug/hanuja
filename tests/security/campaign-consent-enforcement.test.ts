/**
 * Security tests — campaign discount marketing consent enforcement.
 *
 * Invariant (05-security-rules.md §Data Exposure, CLAUDE.md §7.4, KVKK/marketing):
 * a customer only receives a favorite/cart discount campaign email or in-app
 * notification when they hold a MarketingConsent row that is opted-in
 * (emailConsentAt set) and NOT revoked (emailRevokedAt null). Every other state
 * — no consent row at all, an un-opted row, or a revoked row — must be excluded.
 *
 * These assertions are deliberately non-vacuous: each negative case is paired
 * with a positive control proving the consented user IS reached, so a mock that
 * accidentally excludes everyone cannot make the suite pass silently.
 *
 * The store-follow discount flow is governed by its own per-follow opt-out token
 * (StoreFollow.emailOptOutToken), not by MarketingConsent, and is intentionally
 * unaffected by this gate — see store-follow.service and its own tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

// campaign-discount.service imports createNotificationService, which transitively
// imports api/jobs/notification-dispatch.job → the api/lib/prisma singleton
// (`new PrismaClient()` at module load). Tests always inject `notifications`, but
// the import chain still runs at load time, so it is intercepted here.
vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))

import { createCampaignDiscountService } from '../../api/services/campaign-discount.service'

interface MockUser {
  id: string
  email: string
  name: string | null
}

interface MockConsent {
  id: string
  userId: string
  emailConsentAt: Date | null
  emailRevokedAt: Date | null
  optOutToken: string
}

interface MockFavorite {
  userId: string
  productId: string
  createdAt: Date
}

const CONSENT_AT = new Date('2026-07-01T00:00:00.000Z')

/**
 * Prisma double for the campaign audience path, seeded so that four users all
 * favorite the same discounted product but sit in different consent states:
 *   - user-consented : opted-in, not revoked        → MUST be included
 *   - user-no-row    : no MarketingConsent row       → MUST be excluded
 *   - user-unopted   : row exists, emailConsentAt null→ MUST be excluded
 *   - user-revoked   : opted-in then revoked          → MUST be excluded
 */
function createConsentAudiencePrisma() {
  const users: MockUser[] = [
    { id: 'user-consented', email: 'elif.consented@example.com', name: 'Elif Şahin' },
    { id: 'user-no-row', email: 'burak.norow@example.com', name: 'Burak Aslan' },
    { id: 'user-unopted', email: 'derya.unopted@example.com', name: 'Derya Koç' },
    { id: 'user-revoked', email: 'okan.revoked@example.com', name: 'Okan Er' },
    { id: 'seller-user-1', email: 'atolye.sahibi@example.com', name: 'Atölye Sahibi' },
  ]

  const consents: MockConsent[] = [
    { id: 'c-consented', userId: 'user-consented', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-consented' },
    // user-no-row: intentionally absent from this array.
    { id: 'c-unopted', userId: 'user-unopted', emailConsentAt: null, emailRevokedAt: null, optOutToken: 'token-unopted' },
    { id: 'c-revoked', userId: 'user-revoked', emailConsentAt: CONSENT_AT, emailRevokedAt: CONSENT_AT, optOutToken: 'token-revoked' },
    { id: 'c-seller', userId: 'seller-user-1', emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-seller' },
  ]

  const favorites: MockFavorite[] = [
    { userId: 'user-consented', productId: 'product-1', createdAt: new Date('2026-07-02') },
    { userId: 'user-no-row', productId: 'product-1', createdAt: new Date('2026-07-03') },
    { userId: 'user-unopted', productId: 'product-1', createdAt: new Date('2026-07-04') },
    { userId: 'user-revoked', productId: 'product-1', createdAt: new Date('2026-07-05') },
  ]

  const product = { id: 'product-1', name: 'Meşe Yemek Masası', slug: 'mese-yemek-masasi' }

  const dispatches: Array<{
    userId: string
    productId: string | null
    discountFingerprint: string
    source: string
    createdAt: Date
  }> = []

  const prisma = {
    _dispatches: dispatches,
    discountRule: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== 'rule-product') return null
        return {
          id: 'rule-product',
          sellerId: 'seller-1',
          scope: 'PRODUCT' as const,
          categoryId: null,
          startsAt: null,
          createdAt: new Date('2026-07-10T00:00:00.000Z'),
          products: [{ productId: 'product-1' }],
          seller: { userId: 'seller-user-1' },
        }
      }),
    },
    product: {
      findMany: vi.fn(async () => [{ id: product.id, name: product.name, slug: product.slug }]),
    },
    favoriteProduct: {
      findMany: vi.fn(async () =>
        [...favorites]
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((favorite) => ({
            userId: favorite.userId,
            user: users.find((user) => user.id === favorite.userId)!,
            product,
          })),
      ),
    },
    cartItem: {
      // No cart holders in this fixture — the audience is favorite-sourced only.
      findMany: vi.fn(async () => []),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        users.filter((user) => where.id.in.includes(user.id)),
      ),
    },
    marketingConsent: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { userId: { in: string[] }; emailConsentAt?: { not: null }; emailRevokedAt?: null }
        }) =>
          consents.filter((consent) => {
            if (!where.userId.in.includes(consent.userId)) return false
            if (where.emailConsentAt && consent.emailConsentAt === null) return false
            if ('emailRevokedAt' in where && consent.emailRevokedAt !== null) return false
            return true
          }),
      ),
      findUnique: vi.fn(async ({ where }: { where: { optOutToken?: string; userId?: string } }) => {
        if (where.optOutToken !== undefined) {
          return consents.find((consent) => consent.optOutToken === where.optOutToken) ?? null
        }
        return consents.find((consent) => consent.userId === where.userId) ?? null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { emailRevokedAt: Date } }) => {
        const consent = consents.find((entry) => entry.id === where.id)
        if (!consent) throw new Error('Consent not found')
        consent.emailRevokedAt = data.emailRevokedAt
        return consent
      }),
    },
    campaignEmailDispatch: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { userId: { in: string[] }; productId: { in: Array<string | null> }; createdAt: { gte: Date } }
        }) =>
          dispatches
            .filter(
              (dispatch) =>
                where.userId.in.includes(dispatch.userId) &&
                dispatch.productId !== null &&
                where.productId.in.includes(dispatch.productId) &&
                dispatch.createdAt.getTime() >= where.createdAt.gte.getTime(),
            )
            .map((dispatch) => ({ userId: dispatch.userId, productId: dispatch.productId })),
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { userId: string; productId?: string | null; discountFingerprint: string; source: string }
        }) => {
          const exists = dispatches.some(
            (dispatch) =>
              dispatch.userId === data.userId &&
              dispatch.discountFingerprint === data.discountFingerprint &&
              dispatch.source === data.source,
          )
          if (exists) throw new Error('Unique constraint violation')
          dispatches.push({
            userId: data.userId,
            productId: data.productId ?? null,
            discountFingerprint: data.discountFingerprint,
            source: data.source,
            createdAt: new Date(),
          })
          return { id: `dispatch-${dispatches.length}`, ...data }
        },
      ),
    },
  }

  return prisma
}

type ConsentPrisma = ReturnType<typeof createConsentAudiencePrisma>

describe('campaign consent enforcement — resolveTargets audience gate', () => {
  let prisma: ConsentPrisma
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createConsentAudiencePrisma()
    service = createCampaignDiscountService({
      prisma: prisma as unknown as PrismaClient,
      notifications: { send: vi.fn() } as never,
    })
  })

  it('includes the opted-in, not-revoked user (positive control — suite is non-vacuous)', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.map((target) => target.userId)).toContain('user-consented')
  })

  it('excludes a user with no MarketingConsent row at all', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'user-no-row')).toBe(false)
  })

  it('excludes a user whose consent row was never opted-in (emailConsentAt null)', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'user-unopted')).toBe(false)
  })

  it('excludes a user whose consent was revoked (emailRevokedAt set)', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.some((target) => target.userId === 'user-revoked')).toBe(false)
  })

  it('narrows a four-favoriter product down to exactly the single consented user', async () => {
    const targets = await service.resolveTargets('rule-product')
    expect(targets.map((target) => target.userId)).toEqual(['user-consented'])
  })
})

describe('campaign consent enforcement — notifyDiscountAudience dispatch gate', () => {
  let prisma: ConsentPrisma
  let sendMock: ReturnType<typeof vi.fn>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createConsentAudiencePrisma()
    sendMock = vi.fn()
    service = createCampaignDiscountService({
      prisma: prisma as unknown as PrismaClient,
      notifications: { send: sendMock } as never,
    })
  })

  it('sends to the consented user and to no one else, writing exactly one dispatch row', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atölye Kuzey',
    })

    expect(result).toEqual({ notified: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-consented', emailTo: 'elif.consented@example.com' }),
    )
    expect(prisma._dispatches.map((dispatch) => dispatch.userId)).toEqual(['user-consented'])
  })

  it('never sends to no-row, un-opted, or revoked users', async () => {
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-product',
      discountFingerprint: 'rule-product:2026-07-10T00:00:00.000Z',
      sellerName: 'Atölye Kuzey',
    })

    const reachedUserIds = sendMock.mock.calls.map((call) => (call[0] as { userId: string }).userId)
    expect(reachedUserIds).not.toContain('user-no-row')
    expect(reachedUserIds).not.toContain('user-unopted')
    expect(reachedUserIds).not.toContain('user-revoked')
  })
})

describe('campaign consent enforcement — revoke → audience exclusion round-trip', () => {
  let prisma: ConsentPrisma
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createConsentAudiencePrisma()
    service = createCampaignDiscountService({
      prisma: prisma as unknown as PrismaClient,
      notifications: { send: vi.fn() } as never,
    })
  })

  it('drops a previously-included user from the audience after they unsubscribe via token', async () => {
    const before = await service.resolveTargets('rule-product')
    expect(before.map((target) => target.userId)).toContain('user-consented')

    const revoke = await service.revokeMarketingEmailConsentByToken('token-consented')
    expect(revoke).toEqual({ revoked: true })

    const after = await service.resolveTargets('rule-product')
    expect(after.some((target) => target.userId === 'user-consented')).toBe(false)
    // With the last consented user gone, the whole audience is now empty.
    expect(after).toEqual([])
  })

  it('leaves the audience unchanged for an invalid unsubscribe token', async () => {
    const revoke = await service.revokeMarketingEmailConsentByToken('token-does-not-exist')
    expect(revoke).toBeNull()

    const after = await service.resolveTargets('rule-product')
    expect(after.map((target) => target.userId)).toContain('user-consented')
  })
})
