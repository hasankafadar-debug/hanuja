/**
 * Security test — campaign e-mail limits against re-spam (e-mail plan phase 6).
 *
 * A seller can delete and recreate a discount rule to mint a new fingerprint. The shared
 * limits in campaign-email-reservation.ts close that loophole independently of the rule:
 *   - one campaign e-mail per user and product in 7 days,
 *   - at most 3 campaign e-mails per user in any rolling 24 hours,
 * counted on e-mails that were sent or may have been sent (`sending`, `sent`, `uncertain`).
 * A reservation that was released without sending consumes nothing, and a queued (`reserved`)
 * one blocks a duplicate for the same product.
 *
 * The real reservation module runs against an in-memory store; only the price pipeline and
 * the outbox write are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

vi.mock('../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn(),
}))
vi.mock('../../api/services/price-change-reconcile.service', () => ({
  processPriceChangeMarkers: vi.fn(async () => ({ explained: 0, reset: 0, ignored: 0, resetProducts: 0 })),
}))
vi.mock('../../api/services/price-drop-evaluation.service', () => ({
  materializeDuePredictions: vi.fn(async () => ({ materialized: 0, candidates: 0 })),
  evaluatePriceDropCandidates: vi.fn(async () => ({ products: 0, pending: 0, ineligible: 0, grouped: 0 })),
}))
const outbox = vi.hoisted(() => ({ rows: [] as Array<{ userId: string; eventKey?: string }> }))
vi.mock('../../api/services/notification-outbox.service', () => ({
  recordNotification: vi.fn(async (_tx: unknown, payload: { userId: string; eventKey?: string }) => {
    outbox.rows.push(payload)
  }),
  recordNotifications: vi.fn(),
}))

import { createCampaignDiscountService } from '../../api/services/campaign-discount.service'

const CONSENT_AT = new Date('2026-07-01T00:00:00.000Z')
const NOW = new Date('2026-07-17T12:00:00.000Z')
const HOUR = 60 * 60 * 1000

interface DispatchRow {
  id: string
  userId: string
  productId: string | null
  discountFingerprint: string
  source: string
  status: string
  eventKey: string | null
  sentAt: Date | null
  sendingAt: Date | null
  releaseReason?: string | null
  createdAt: Date
}

function matches(row: DispatchRow, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Array<Record<string, unknown>>).some((option) => matches(row, option))) return false
      continue
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (condition === null) {
      if (value !== null) return false
    } else if (typeof condition === 'object' && condition !== null && !(condition instanceof Date)) {
      const c = condition as { in?: unknown[]; gte?: Date; not?: unknown }
      if (c.in && !c.in.includes(value)) return false
      if (c.gte && !(value instanceof Date && value.getTime() >= c.gte.getTime())) return false
      if ('not' in c && value === c.not) return false
    } else if (value !== condition) {
      return false
    }
  }
  return true
}

function createPrisma() {
  const product = { id: 'product-respam', sellerId: 'seller-1', name: 'Kampanyalı Ürün', slug: 'kampanyali-urun' }
  const rule = (id: string, createdAt: string) => ({
    id,
    sellerId: 'seller-1',
    scope: 'PRODUCT' as const,
    categoryId: null,
    startsAt: null,
    createdAt: new Date(createdAt),
    products: [{ productId: product.id }],
    seller: { userId: 'seller-user-1' },
  })
  const rules: Record<string, ReturnType<typeof rule>> = {
    'rule-original': rule('rule-original', '2026-07-10T00:00:00.000Z'),
    'rule-recreated': rule('rule-recreated', '2026-07-12T00:00:00.000Z'),
  }
  const target = { id: 'user-target', email: 'target@example.com', name: 'Hedef Kullanici' }
  const dispatches: DispatchRow[] = []

  const prisma = {
    _dispatches: dispatches,
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    $executeRaw: vi.fn(async () => 1),
    discountRule: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rules[where.id] ?? null) },
    product: { findMany: vi.fn(async () => [product]) },
    favoriteProduct: { findMany: vi.fn(async () => []) },
    priceDropEvent: { findMany: vi.fn(async () => []) },
    cartItem: { findMany: vi.fn(async () => [{ productId: product.id, cart: { userId: target.id } }]) },
    user: { findMany: vi.fn(async () => [target]) },
    marketingConsent: {
      findMany: vi.fn(async () => [
        { userId: target.id, emailConsentAt: CONSENT_AT, emailRevokedAt: null, optOutToken: 'token-target' },
      ]),
    },
    campaignEmailDispatch: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.find((row) => matches(row, where)) ?? null,
      ),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.filter((row) => matches(row, where)).length,
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        dispatches.filter((row) => matches(row, where)),
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Partial<DispatchRow> }) => {
        const row: DispatchRow = {
          id: `dispatch-${dispatches.length + 1}`,
          userId: data.userId!,
          productId: data.productId ?? null,
          discountFingerprint: data.discountFingerprint!,
          source: data.source!,
          status: data.status ?? 'reserved',
          eventKey: data.eventKey ?? null,
          sentAt: null,
          sendingAt: null,
          createdAt: NOW,
        }
        dispatches.push(row)
        return { id: row.id }
      }),
    },
  }
  return prisma
}

describe('campaign e-mail limits — recreate-to-respam (end-to-end)', () => {
  let prisma: ReturnType<typeof createPrisma>
  let service: ReturnType<typeof createCampaignDiscountService>

  const original = {
    discountRuleId: 'rule-original',
    discountFingerprint: 'rule-original:2026-07-10T00:00:00.000Z',
    sellerName: 'Atolye Kuzey',
    now: NOW,
  }
  const recreated = {
    discountRuleId: 'rule-recreated',
    discountFingerprint: 'rule-recreated:2026-07-12T00:00:00.000Z',
    sellerName: 'Atolye Kuzey',
    now: NOW,
  }

  beforeEach(() => {
    outbox.rows.length = 0
    prisma = createPrisma()
    service = createCampaignDiscountService({ prisma: prisma as unknown as PrismaClient })
  })

  it('queues once for the original rule (positive control — suite is non-vacuous)', async () => {
    expect(await service.notifyDiscountAudience(original)).toEqual({ notified: 1, superseded: 0, skipped: 0 })
    expect(outbox.rows).toHaveLength(1)
  })

  it('blocks the recreated rule while the first e-mail is still queued', async () => {
    await service.notifyDiscountAudience(original)
    expect(await service.notifyDiscountAudience(recreated)).toEqual({ notified: 0, superseded: 0, skipped: 1 })
    expect(outbox.rows).toHaveLength(1)
  })

  it('blocks the recreated rule for 7 days once the first e-mail was sent', async () => {
    await service.notifyDiscountAudience(original)
    Object.assign(prisma._dispatches[0]!, { status: 'sent', sentAt: new Date(NOW.getTime() - 6 * 24 * HOUR) })

    expect(await service.notifyDiscountAudience(recreated)).toEqual({ notified: 0, superseded: 0, skipped: 1 })
  })

  it('an SMTP outcome that is uncertain counts like a sent e-mail', async () => {
    await service.notifyDiscountAudience(original)
    Object.assign(prisma._dispatches[0]!, { status: 'uncertain', sendingAt: new Date(NOW.getTime() - HOUR) })

    expect(await service.notifyDiscountAudience(recreated)).toEqual({ notified: 0, superseded: 0, skipped: 1 })
  })

  it('allows the recreated rule once the 7 days have passed (contrast case)', async () => {
    await service.notifyDiscountAudience(original)
    Object.assign(prisma._dispatches[0]!, { status: 'sent', sentAt: new Date(NOW.getTime() - 8 * 24 * HOUR) })

    expect(await service.notifyDiscountAudience(recreated)).toEqual({ notified: 1, superseded: 0, skipped: 0 })
  })

  it('a reservation released without sending consumes nothing', async () => {
    await service.notifyDiscountAudience(original)
    Object.assign(prisma._dispatches[0]!, { status: 'released', releaseReason: 'price_changed' })

    expect(await service.notifyDiscountAudience(recreated)).toEqual({ notified: 1, superseded: 0, skipped: 0 })
  })

  it('stops at 3 campaign e-mails per user in a rolling 24 hours, across products', async () => {
    for (const [index, hoursAgo] of [1, 5, 23].entries()) {
      prisma._dispatches.push({
        id: `other-${index}`,
        userId: 'user-target',
        productId: `other-product-${index}`,
        discountFingerprint: `other-${index}`,
        source: index === 0 ? 'price_drop' : 'cart',
        status: 'sent',
        eventKey: null,
        sentAt: new Date(NOW.getTime() - hoursAgo * HOUR),
        sendingAt: null,
        createdAt: new Date(NOW.getTime() - hoursAgo * HOUR),
      })
    }
    expect(await service.notifyDiscountAudience(original)).toEqual({ notified: 0, superseded: 0, skipped: 1 })

    // One of the three moves out of the window → room for one more.
    prisma._dispatches[2]!.sentAt = new Date(NOW.getTime() - 25 * HOUR)
    expect(await service.notifyDiscountAudience(original)).toEqual({ notified: 1, superseded: 0, skipped: 0 })
  })
})
