/**
 * Security test — campaign discount recreate-to-respam cooldown.
 *
 * Invariant (07-marketplace-finance-rules.md is not the source here; this is a
 * KVKK/marketing-abuse concern under 05-security-rules.md §Fraud and Risk Rules
 * and CLAUDE.md §7.4 auditability): CampaignEmailDispatch dedupe keyed only on
 * discountFingerprint lets a seller delete and recreate a discount rule to mint
 * a brand-new fingerprint and re-email the same audience without limit. The
 * per-(userId, productId) cooldown (CAMPAIGN_EMAIL_COOLDOWN_DAYS) closes this
 * loophole independent of fingerprint/rule identity.
 *
 * This test proves the loophole is closed end-to-end at the service level: a
 * distinct rule id with a distinct fingerprint, targeting the same user+product,
 * produces zero sends and zero new dispatch rows while inside the cooldown window.
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

interface MockRule {
  id: string
  sellerId: string
  scope: 'PRODUCT'
  categoryId: null
  startsAt: null
  createdAt: Date
  products: Array<{ productId: string }>
  seller: { userId: string }
}

const CONSENT_AT = new Date('2026-07-01T00:00:00.000Z')

/**
 * Two distinct DiscountRule rows targeting the SAME product — simulating a
 * seller deleting rule-original and creating rule-recreated in its place.
 * Both resolve to the same single-product audience.
 */
function createRecreateRespamPrisma() {
  const product = { id: 'product-respam', name: 'Kampanyalı Ürün', slug: 'kampanyali-urun' }

  const rules: Record<string, MockRule> = {
    'rule-original': {
      id: 'rule-original',
      sellerId: 'seller-1',
      scope: 'PRODUCT',
      categoryId: null,
      startsAt: null,
      createdAt: new Date('2026-07-10T00:00:00.000Z'),
      products: [{ productId: product.id }],
      seller: { userId: 'seller-user-1' },
    },
    'rule-recreated': {
      id: 'rule-recreated',
      sellerId: 'seller-1',
      scope: 'PRODUCT',
      categoryId: null,
      startsAt: null,
      // A freshly-created row: new id, new createdAt, new fingerprint downstream.
      createdAt: new Date('2026-07-12T00:00:00.000Z'),
      products: [{ productId: product.id }],
      seller: { userId: 'seller-user-1' },
    },
  }

  const target = { id: 'user-target', email: 'target@example.com', name: 'Hedef Kullanici' }
  const consent = { id: 'consent-target', userId: target.id, emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-target' }

  const favorites = [{ userId: target.id, productId: product.id, createdAt: new Date('2026-07-02') }]

  const dispatches: Array<{ userId: string; productId: string | null; discountFingerprint: string; source: string; createdAt: Date }> = []

  const prisma = {
    _dispatches: dispatches,
    discountRule: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rules[where.id] ?? null),
    },
    product: {
      findMany: vi.fn(async () => [product]),
    },
    favoriteProduct: {
      findMany: vi.fn(async () =>
        favorites.map((favorite) => ({
          userId: favorite.userId,
          user: target,
          product,
        })),
      ),
    },
    cartItem: {
      findMany: vi.fn(async () => []),
    },
    user: {
      findMany: vi.fn(async () => [target]),
    },
    marketingConsent: {
      findMany: vi.fn(async () => [{ userId: target.id, optOutToken: consent.optOutToken }]),
      findUnique: vi.fn(async ({ where }: { where: { userId?: string; optOutToken?: string } }) => {
        if (where.userId !== undefined) return where.userId === target.id ? consent : null
        return where.optOutToken === consent.optOutToken ? consent : null
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
          return { id: `dispatch-${dispatches.length}` }
        },
      ),
    },
  }

  return prisma
}

describe('campaign discount — recreate-to-respam cooldown (end-to-end)', () => {
  let prisma: ReturnType<typeof createRecreateRespamPrisma>
  let sendMock: ReturnType<typeof vi.fn>
  let service: ReturnType<typeof createCampaignDiscountService>

  beforeEach(() => {
    prisma = createRecreateRespamPrisma()
    sendMock = vi.fn()
    service = createCampaignDiscountService({
      prisma: prisma as unknown as PrismaClient,
      notifications: { send: sendMock } as never,
    })
  })

  it('sends once for the original rule (positive control — suite is non-vacuous)', async () => {
    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-original',
      discountFingerprint: 'rule-original:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(result).toEqual({ notified: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('blocks the recreated rule (new id, new fingerprint) targeting the same user+product within the cooldown window', async () => {
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-original',
      discountFingerprint: 'rule-original:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })
    sendMock.mockClear()

    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-recreated',
      discountFingerprint: 'rule-recreated:2026-07-12T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(result).toEqual({ notified: 0 })
    expect(sendMock).not.toHaveBeenCalled()
    // No new dispatch row was written for the recreated rule's fingerprint.
    expect(
      prisma._dispatches.some((dispatch) => dispatch.discountFingerprint === 'rule-recreated:2026-07-12T00:00:00.000Z'),
    ).toBe(false)
  })

  it('would allow the recreated rule to send if the cooldown had already elapsed (contrast case)', async () => {
    await service.notifyDiscountAudience({
      discountRuleId: 'rule-original',
      discountFingerprint: 'rule-original:2026-07-10T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    // Simulate the cooldown window having elapsed.
    for (const dispatch of prisma._dispatches) {
      dispatch.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    }
    sendMock.mockClear()

    const result = await service.notifyDiscountAudience({
      discountRuleId: 'rule-recreated',
      discountFingerprint: 'rule-recreated:2026-07-12T00:00:00.000Z',
      sellerName: 'Atolye Kuzey',
    })

    expect(result).toEqual({ notified: 1 })
    expect(sendMock).toHaveBeenCalledTimes(1)
  })
})
