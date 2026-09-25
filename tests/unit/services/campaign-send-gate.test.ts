// Isolate pipeline behavior; actual address and token policy has dedicated tests.
vi.mock('../../../api/services/marketing-recipient-policy', () => ({
  checkMarketingEmailRecipient: async (db: any, userId: string) => {
    const consent = await db.marketingConsent.findUnique({ where: { userId } })
    return !consent?.emailConsentAt || consent.emailRevokedAt ? 'MARKETING_CONSENT_MISSING' : null
  },
}))
// This suite isolates existing campaign behavior with a configured channel. Central fail-closed behavior has dedicated tests.
vi.mock('../../../api/services/marketing-channel.service', () => ({
  getMarketingChannelStatus: async () => ({ canSend: true }),
}))
/**
 * Campaign send gate (e-mail plan phase 6) — runs before the in-app and e-mail legs.
 * The price pipeline pieces are controlled; the reservation limit checks are the real ones.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  processMarkers: vi.fn(),
  evaluateNow: vi.fn(),
  order: [] as string[],
}))
vi.mock('../../../api/services/price-change-reconcile.service', () => ({
  processPriceChangeMarkers: mocks.processMarkers,
  hasPendingMarkers: async (client: { priceChangeMarker: { count: () => Promise<number> } }) =>
    (await client.priceChangeMarker.count()) > 0,
}))
vi.mock('../../../api/services/price-drop-evaluation.service', () => ({
  evaluateEventNow: mocks.evaluateNow,
}))

import { runCampaignSendGate } from '../../../api/services/campaign-send-gate'

const NOW = new Date('2026-10-20T10:00:00.000Z')
const HOUR = 60 * 60 * 1000

interface Row {
  id: string
  userId: string
  productId: string | null
  source: string
  status: string
  eventKey: string | null
  discountFingerprint: string
  releaseReason: string | null
  sentAt: Date | null
  sendingAt: Date | null
  createdAt: Date
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(condition as Array<Record<string, unknown>>).some((option) => matches(row, option))) return false
      continue
    }
    const value = (row as unknown as Record<string, unknown>)[key]
    if (condition === null) {
      if (value !== null) return false
    } else if (typeof condition === 'object' && !(condition instanceof Date)) {
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

function setup(
  options: { event?: { status: string; reason?: string | null } | null; consent?: boolean; pendingMarkers?: number } = {},
) {
  const rows: Row[] = []
  const add = (row: Partial<Row>) => {
    const full: Row = {
      id: `r${rows.length + 1}`,
      userId: 'u1',
      productId: 'p1',
      source: 'cart',
      status: 'reserved',
      eventKey: null,
      discountFingerprint: `fp-${rows.length + 1}`,
      releaseReason: null,
      sentAt: null,
      sendingAt: null,
      createdAt: NOW,
      ...row,
    }
    rows.push(full)
    return full
  }
  const event =
    options.event === null
      ? null
      : { historySeq: 1n, productId: 'p1', sellerId: 's1', priceKey: 'product:p1', status: 'dispatching', reason: null, ...options.event }
  const prisma = {
    $executeRaw: vi.fn(async () => {
      mocks.order.push('user-lock')
      return 1
    }),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    campaignEmailDispatch: {
      findUnique: vi.fn(async ({ where }: { where: { eventKey?: string; id?: string } }) =>
        rows.find((row) => (where.eventKey ? row.eventKey === where.eventKey : row.id === where.id)) ?? null,
      ),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)).length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((entry) => entry.id === where.id)!
        Object.assign(row, data)
        return row
      }),
    },
    priceDropEvent: { findUnique: vi.fn(async () => event) },
    priceChangeMarker: { count: vi.fn(async () => options.pendingMarkers ?? 0) },
    marketingConsent: {
      findUnique: vi.fn(async () =>
        options.consent === false
          ? { emailConsentAt: NOW, emailRevokedAt: NOW }
          : { emailConsentAt: NOW, emailRevokedAt: null },
      ),
    },
  }
  return { prisma, rows, add }
}

function gate(prisma: unknown, type: string, eventKey: string) {
  return runCampaignSendGate(prisma as never, { type: type as never, eventKey, userId: 'u1', now: NOW })
}

describe('runCampaignSendGate', () => {
  beforeEach(() => {
    mocks.order.length = 0
    mocks.processMarkers.mockReset().mockImplementation(async () => {
      mocks.order.push('markers')
      return { explained: 0, reset: 0, ignored: 0, resetProducts: 0 }
    })
    mocks.evaluateNow.mockReset().mockImplementation(async () => {
      mocks.order.push('evaluate')
      return { eligible: true, windowMin: 1, previousPrice: 2 }
    })
  })

  it('skips the closed legacy favorite and store-follow types', async () => {
    const { prisma } = setup()
    for (const type of ['product_discount_favorited', 'store_discount_followed_seller']) {
      expect(await gate(prisma, type, 'k')).toEqual({ proceed: false, reason: 'LEGACY_CAMPAIGN_DISABLED' })
    }
  })

  it('lets non-campaign types through untouched', async () => {
    const { prisma } = setup()
    expect(await gate(prisma, 'order_shipped', 'k')).toEqual({ proceed: true })
    expect(prisma.campaignEmailDispatch.findUnique).not.toHaveBeenCalled()
  })

  it('refuses a campaign e-mail without its reservation', async () => {
    const { prisma } = setup()
    expect(await gate(prisma, 'product_discount_in_cart', 'missing')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RESERVATION_MISSING',
    })
  })

  it('moves a valid cart reservation to sending', async () => {
    const { prisma, add } = setup()
    const row = add({ eventKey: 'cart-key' })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({ proceed: true })
    expect(row).toMatchObject({ status: 'sending', sendingAt: NOW })
  })

  it('releases a cart reservation when a lowest-price e-mail for the same product exists', async () => {
    const { prisma, add } = setup()
    add({ source: 'price_drop', status: 'sent', sentAt: new Date(NOW.getTime() - HOUR) })
    const row = add({ eventKey: 'cart-key' })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:cooldown',
    })
    expect(row.status).toBe('released')
  })

  it('a queued lowest-price reservation for the same product wins over the cart e-mail', async () => {
    const { prisma, add } = setup()
    add({ source: 'price_drop', status: 'reserved' })
    const row = add({ eventKey: 'cart-key' })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:superseded_by_price_drop',
    })
    expect(row.status).toBe('released')
  })

  it('re-checks the 24-hour cap at send time; a queued reservation does not count', async () => {
    const { prisma, add } = setup()
    add({ productId: 'a', status: 'sent', sentAt: new Date(NOW.getTime() - HOUR) })
    add({ productId: 'b', status: 'uncertain', sendingAt: new Date(NOW.getTime() - 2 * HOUR) })
    add({ productId: 'c', status: 'reserved' })
    const row = add({ eventKey: 'cart-key' })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({ proceed: true })

    const second = add({ productId: 'd', eventKey: 'cart-key-2' })
    // The first one is now `sending` → three counted e-mails in 24 hours.
    expect(row.status).toBe('sending')
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key-2')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:daily_cap',
    })
    expect(second.releaseReason).toBe('daily_cap')
  })

  it('releases when marketing consent was withdrawn after queueing', async () => {
    const { prisma, add } = setup({ consent: false })
    add({ eventKey: 'cart-key' })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:no_consent',
    })
  })

  it('lowest-price: processes pending markers before evaluating, then evaluates for now', async () => {
    const { prisma, add } = setup()
    add({ source: 'price_drop', eventKey: 'pd-key', discountFingerprint: 'price-drop:e1' })
    expect(await gate(prisma, 'product_price_drop', 'pd-key')).toEqual({ proceed: true })
    expect(mocks.processMarkers).toHaveBeenCalledWith(prisma, {
      scope: { productIds: ['p1'], sellerIds: ['s1'] },
      now: NOW,
    })
    expect(mocks.order.indexOf('markers')).toBeLessThan(mocks.order.indexOf('evaluate'))
    expect(mocks.evaluateNow).toHaveBeenCalledWith(prisma, expect.objectContaining({ priceKey: 'product:p1' }), NOW)
  })

  it('lowest-price: an event cancelled by a history reset releases the reservation', async () => {
    const { prisma, add } = setup({ event: { status: 'cancelled', reason: 'history_reset' } })
    const row = add({ source: 'price_drop', eventKey: 'pd-key', discountFingerprint: 'price-drop:e1' })
    expect(await gate(prisma, 'product_price_drop', 'pd-key')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:history_reset',
    })
    expect(row.status).toBe('released')
    expect(mocks.evaluateNow).not.toHaveBeenCalled()
  })

  it('lowest-price: a marker that appeared after the inline processing blocks the decision (retried)', async () => {
    const { prisma, add } = setup({ pendingMarkers: 1 })
    const row = add({ source: 'price_drop', eventKey: 'pd-key', discountFingerprint: 'price-drop:e1' })
    await expect(gate(prisma, 'product_price_drop', 'pd-key')).rejects.toThrow('PRICE_HISTORY_MARKERS_PENDING')
    expect(row.status).toBe('reserved')
    expect(mocks.evaluateNow).not.toHaveBeenCalled()
  })

  it('lowest-price: a price that is no longer the 15-day minimum is not sent', async () => {
    mocks.evaluateNow.mockResolvedValueOnce({ eligible: false, reason: 'above_window_min', windowMin: 1, previousPrice: 2 })
    const { prisma, add } = setup()
    add({ source: 'price_drop', eventKey: 'pd-key', discountFingerprint: 'price-drop:e1' })
    expect(await gate(prisma, 'product_price_drop', 'pd-key')).toEqual({
      proceed: false,
      reason: 'CAMPAIGN_RELEASED:above_window_min',
    })
  })

  it('a reservation already past the gate is left to the delivery idempotency', async () => {
    const { prisma, add } = setup()
    add({ eventKey: 'cart-key', status: 'sent', sentAt: NOW })
    expect(await gate(prisma, 'product_discount_in_cart', 'cart-key')).toEqual({ proceed: true })
  })
})
