/**
 * Lowest-price-of-15-days (e-mail plan phase 6) against a real PostgreSQL database: the
 * triggers, advisory locks, txid matching, DISTINCT ON timelines and per-user limits are what
 * make the history trustworthy, and a mocked client cannot show any of them.
 *
 * Fixtures write history rows with past timestamps — only here, in a disposable schema. In
 * production the history is never back-filled.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const h = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../../api/lib/mailer', () => ({ sendEmail: h.send }))
// These tests exercise the price-history and dispatch pipeline with marketing
// enabled. Readiness and IYS fail-closed behavior are covered against the real
// module in marketing-channel-control.test.ts.
vi.mock('../../api/services/marketing-channel.service', () => ({
  getMarketingChannelStatus: vi.fn(async () => ({ canSend: true })),
  releaseBlockedMarketingReservation: vi.fn(async () => undefined),
}))
vi.mock('../../api/services/marketing-recipient-policy', () => ({
  checkMarketingEmailRecipient: vi.fn(async (db: PrismaClient | Prisma.TransactionClient, userId: string) => {
    const consent = await db.marketingConsent.findUnique({
      where: { userId },
      select: { emailConsentAt: true, emailRevokedAt: true },
    })
    return consent?.emailConsentAt && !consent.emailRevokedAt ? null : 'MARKETING_ADDRESS_CONSENT_MISSING'
  }),
}))
vi.mock('../../api/lib/prisma', () => ({
  get prisma() {
    return prisma
  },
}))

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error('NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Refusing non-local notification test database')
const schema = `pricehist_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
url.searchParams.set('connection_limit', '12')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { recordPriceChanges } from '../../api/services/price-history.service'
import {
  baselineUntrackedProducts,
  processPriceChangeMarkers,
  reconcilePriceHistory,
} from '../../api/services/price-change-reconcile.service'
import {
  evaluatePriceDropCandidates,
  loadKeyTimeline,
  materializeDuePredictions,
} from '../../api/services/price-drop-evaluation.service'
import { advancePriceDropDispatch } from '../../api/services/price-drop-dispatch.service'
import { reserveCampaignEmail } from '../../api/services/campaign-email-reservation'
import { runCampaignSendGate } from '../../api/services/campaign-send-gate'
import { createDiscountService } from '../../api/services/discount.service'
import { processNotificationDispatch } from '../../api/jobs/notification-dispatch.job'
import { deriveRuleStatus } from '../../api/domain/effective-price'
import { effectiveTimeline } from '../../api/domain/price-drop-eligibility'

const DAY = 24 * 60 * 60 * 1000
const MIN = 60 * 1000

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
}, 120_000)

afterAll(async () => {
  if (!/^pricehist_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

beforeEach(() => {
  h.send.mockReset().mockResolvedValue({ messageId: '<m@test>', providerMessageId: randomUUID(), transport: 'smtp' })
})

// ── Fixtures ────────────────────────────────────────────────────────────────

async function seedSeller() {
  const suffix = randomUUID().slice(0, 12)
  const user = await prisma.user.create({ data: { email: `s-${suffix}@example.test`, role: 'seller' } })
  const seller = await prisma.seller.create({
    data: { userId: user.id, slug: `m-${suffix}`, displayName: `Mağaza ${suffix}`, status: 'active' },
  })
  return { ...seller, userId: user.id }
}

async function seedUser(options: { consent?: boolean; role?: 'customer' | 'admin' | 'seller' } = {}) {
  const suffix = randomUUID().slice(0, 12)
  const user = await prisma.user.create({
    data: { email: `c-${suffix}@example.test`, name: `Müşteri ${suffix}`, role: options.role ?? 'customer' },
  })
  if (options.consent !== false) {
    await prisma.marketingConsent.create({
      data: { userId: user.id, emailConsentAt: new Date(), consentSource: 'signup', optOutToken: randomUUID() },
    })
  }
  return user
}

/** A product created by the hooked path, with its price history starting at `at`. */
async function createProduct(
  sellerId: string,
  price: number,
  options: { at?: Date; variants?: number[]; stock?: number; status?: 'published' | 'draft' } = {},
) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        sellerId,
        slug: `u-${randomUUID().slice(0, 16)}`,
        name: 'Meşe Sehpa',
        status: options.status ?? 'published',
        price: new Decimal(price),
        stockQuantity: options.stock ?? 5,
      },
    })
    for (const [index, variantPrice] of (options.variants ?? []).entries()) {
      await tx.productVariant.create({
        data: {
          productId: product.id,
          name: `Varyant ${index + 1}`,
          barcode: `8${String(Date.now()).slice(-8)}${String(index).padStart(2, '0')}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 13),
          price: new Decimal(variantPrice),
          stockQuantity: 3,
          options: {},
        },
      })
    }
    await recordPriceChanges(tx, { productIds: [product.id], source: 'product_write', ...(options.at ? { now: options.at } : {}) })
    return product
  })
}

async function setPrice(productId: string, price: number, now?: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { price: new Decimal(price) } })
    await recordPriceChanges(tx, { productIds: [productId], source: 'product_write', ...(now ? { now } : {}) })
  })
}

async function favorite(userId: string, productId: string) {
  await prisma.favoriteProduct.create({ data: { userId, productId } })
}

async function drainMarkers(now?: Date) {
  for (;;) {
    const result = await processPriceChangeMarkers(prisma, now ? { now } : {})
    if (result.explained + result.reset + result.ignored === 0) return
  }
}

async function history(productId: string) {
  return prisma.productPriceHistory.findMany({ where: { productId }, orderBy: [{ recordedAt: 'asc' }, { seq: 'asc' }] })
}

async function markAllMarkersProcessed() {
  await prisma.priceChangeMarker.updateMany({ where: { processedAt: null }, data: { processedAt: new Date(), outcome: 'ignored' } })
}

/** Ticks the dispatcher until this product's event is finished (other tests' events share the queue). */
async function dispatchUntilDone(productId: string, options: { cap?: number } = {}) {
  for (let round = 0; round < 30; round += 1) {
    const open = await prisma.priceDropEvent.count({ where: { productId, status: { in: ['pending', 'dispatching'] } } })
    if (!open) return
    await advancePriceDropDispatch(prisma, options)
  }
  throw new Error('dispatch did not finish')
}

async function dispatchOutbox(eventKey: string) {
  const row = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey } })
  await processNotificationDispatch({ id: row.id, data: row.payload } as never)
}

// ── Triggers ────────────────────────────────────────────────────────────────

describe('change markers (triggers)', () => {
  it('the SQL live status function agrees with deriveRuleStatus', async () => {
    const at = new Date('2026-10-01T10:00:00.000Z')
    const cases: Array<[string, Date | null, Date | null]> = []
    for (const status of ['ACTIVE', 'SCHEDULED', 'PAUSED', 'EXPIRED']) {
      for (const startsAt of [null, new Date(at.getTime() - 1), at, new Date(at.getTime() + 1)]) {
        for (const endsAt of [null, new Date(at.getTime() - 1), at, new Date(at.getTime() + 1)]) {
          cases.push([status, startsAt, endsAt])
        }
      }
    }
    for (const [status, startsAt, endsAt] of cases) {
      const [row] = await prisma.$queryRawUnsafe<Array<{ s: string }>>(
        `SELECT "hanuja_discount_rule_live_status"($1::"DiscountStatus", $2::timestamp(3), $3::timestamp(3), $4::timestamp(3)) AS s`,
        status,
        startsAt,
        endsAt,
        at,
      )
      expect(row?.s, `${status} ${startsAt?.toISOString()} ${endsAt?.toISOString()}`).toBe(
        deriveRuleStatus({ status: status as never, startsAt, endsAt }, at),
      )
    }
  })

  it('a hooked write is explained; a raw SQL write resets trust and cancels later rows', async () => {
    const seller = await seedSeller()
    const product = await createProduct(seller.id, 100, { at: new Date(Date.now() - 20 * DAY) })
    await setPrice(product.id, 95)
    await drainMarkers()
    const explained = await prisma.priceChangeMarker.findMany({ where: { productId: product.id } })
    expect(explained.length).toBeGreaterThan(0)
    expect(explained.every((marker) => marker.outcome === 'explained')).toBe(true)
    const trustedSince = (await prisma.priceKeyTracking.findFirstOrThrow({ where: { productId: product.id } })).trackedSince

    await prisma.$executeRawUnsafe(`UPDATE products SET price = 80 WHERE id = $1`, product.id)
    await drainMarkers()

    const tracking = await prisma.priceKeyTracking.findFirstOrThrow({ where: { productId: product.id } })
    expect(tracking.lastResetReason).toBe('unexplained_change')
    expect(tracking.trackedSince.getTime()).toBeGreaterThan(trustedSince.getTime())
    const rows = await history(product.id)
    const last = rows.filter((row) => !row.cancelledAt).at(-1)!
    expect(last).toMatchObject({ source: 'reconcile' })
    expect(last.price.toString()).toBe('80')
  })

  it('a status flip whose time has come leaves no marker; pausing does', async () => {
    const seller = await seedSeller()
    await createProduct(seller.id, 100)
    const rule = await createDiscountService({ prisma }).createRule(seller.id, {
      name: 'Kampanya',
      scope: 'ALL_PRODUCTS',
      type: 'PERCENT',
      value: 10,
      startsAt: new Date(Date.now() - MIN),
    })
    await drainMarkers()
    // The activation scan flips SCHEDULED → ACTIVE once startsAt has passed: not a price change.
    await prisma.$executeRawUnsafe(`UPDATE discount_rules SET status = 'SCHEDULED' WHERE id = $1`, rule.id)
    await markAllMarkersProcessed()
    await prisma.discountRule.updateMany({ where: { id: rule.id, status: 'SCHEDULED' }, data: { status: 'ACTIVE' } })
    expect(await prisma.priceChangeMarker.count({ where: { ruleId: rule.id, processedAt: null } })).toBe(0)

    await prisma.discountRule.update({ where: { id: rule.id }, data: { status: 'PAUSED' } })
    expect(await prisma.priceChangeMarker.count({ where: { ruleId: rule.id, processedAt: null } })).toBe(1)
    await markAllMarkersProcessed()
  })

  it('deleting a product in a PRODUCT-scope rule does not reset the other products of the seller', async () => {
    const seller = await seedSeller()
    const kept = await createProduct(seller.id, 100)
    const removed = await createProduct(seller.id, 120)
    await createDiscountService({ prisma }).createRule(seller.id, {
      name: 'Tek ürün',
      scope: 'PRODUCT',
      type: 'PERCENT',
      value: 10,
      productIds: [removed.id],
    })
    await drainMarkers()
    // The seller-panel delete is a raw delete; it cascades to discount_rule_products.
    await prisma.product.delete({ where: { id: removed.id } })
    await drainMarkers()
    expect(await prisma.priceKeyTracking.count({ where: { productId: kept.id, lastResetReason: { not: null } } })).toBe(0)
  })

  it('variant and rule-product inserts/deletes leave markers', async () => {
    const seller = await seedSeller()
    const product = await createProduct(seller.id, 100, { variants: [110] })
    await drainMarkers()
    await prisma.productVariant.deleteMany({ where: { productId: product.id } })
    const rule = await prisma.discountRule.create({
      data: { sellerId: seller.id, name: 'Ham', scope: 'PRODUCT', type: 'PERCENT', value: new Decimal(5) },
    })
    await prisma.discountRuleProduct.create({ data: { discountRuleId: rule.id, productId: product.id } })
    const entities = (await prisma.priceChangeMarker.findMany({ where: { processedAt: null, sellerId: seller.id } })).map(
      (marker) => marker.entity,
    )
    expect(entities.sort()).toEqual(['rule', 'rule_product', 'variant'])
    await drainMarkers()
  })
})

// ── Recorder and boundaries ─────────────────────────────────────────────────

describe('recorder and rule boundaries', () => {
  it('baseline writes the future start and end of an existing short campaign with exact times', async () => {
    const seller = await seedSeller()
    const product = await prisma.product.create({
      data: { sellerId: seller.id, slug: `u-${randomUUID().slice(0, 16)}`, name: 'Eski', status: 'published', price: new Decimal(100), stockQuantity: 2 },
    })
    const start = new Date(Date.now() + 5 * MIN)
    const end = new Date(Date.now() + 10 * MIN)
    await prisma.discountRule.create({
      data: { sellerId: seller.id, name: 'Kısa', scope: 'ALL_PRODUCTS', type: 'PERCENT', value: new Decimal(10), status: 'SCHEDULED', startsAt: start, endsAt: end },
    })
    // Data that existed before the deploy has no markers (the triggers are created by the migration).
    await markAllMarkersProcessed()

    await baselineUntrackedProducts(prisma)
    const rows = (await history(product.id)).filter((row) => !row.cancelledAt)
    expect(rows.map((row) => [row.source, row.predicted, row.price.toString()])).toEqual([
      ['baseline', false, '100'],
      ['rule_boundary', true, '90'],
      ['rule_boundary', true, '100'],
    ])
    expect(rows[1]!.recordedAt.toISOString()).toBe(start.toISOString())
    expect(rows[2]!.recordedAt.getTime()).toBe(end.getTime() + 1)

    // When the start passes the drop becomes a candidate; the history is younger than 15 days.
    await materializeDuePredictions(prisma, { now: new Date(start.getTime() + 1), productIds: [product.id] })
    await evaluatePriceDropCandidates(prisma, { now: new Date(start.getTime() + 1), productIds: [product.id] })
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })
    expect(event).toMatchObject({ status: 'ineligible', reason: 'insufficient_history' })
  })

  it('a rule written through the service records its boundaries; editing it supersedes old predictions', async () => {
    const seller = await seedSeller()
    const product = await createProduct(seller.id, 200)
    const discounts = createDiscountService({ prisma })
    const start = new Date(Date.now() + 1000)
    const end = new Date(Date.now() + 2000)
    const rule = await discounts.createRule(seller.id, {
      name: 'Anlık',
      scope: 'PRODUCT',
      type: 'FIXED_AMOUNT',
      value: 50,
      productIds: [product.id],
      startsAt: start,
      endsAt: end,
    })
    let predicted = (await history(product.id)).filter((row) => row.predicted && !row.cancelledAt)
    expect(predicted.map((row) => [row.recordedAt.getTime(), row.price.toString()])).toEqual([
      [start.getTime(), '150'],
      [end.getTime() + 1, '200'],
    ])

    const newEnd = new Date(Date.now() + 60 * MIN)
    await discounts.updateRule(seller.id, rule.id, { endsAt: newEnd })
    const rows = await history(product.id)
    expect(rows.filter((row) => row.cancelReason === 'superseded').length).toBeGreaterThanOrEqual(2)
    predicted = rows.filter((row) => row.predicted && !row.cancelledAt)
    expect(predicted.map((row) => row.recordedAt.getTime())).toEqual([start.getTime(), newEnd.getTime() + 1])
    await drainMarkers()
    expect(await prisma.priceKeyTracking.count({ where: { productId: product.id, lastResetReason: { not: null } } })).toBe(0)
  })

  it('a write at the same instant as a predicted boundary wins; the shadowed row is no price and no event', async () => {
    const seller = await seedSeller()
    const product = await createProduct(seller.id, 100, { at: new Date(Date.now() - 20 * DAY) })
    const at = new Date(Date.now() + 30 * MIN)
    await createDiscountService({ prisma }).createRule(seller.id, {
      name: 'Aynı an',
      scope: 'ALL_PRODUCTS',
      type: 'PERCENT',
      value: 10,
      startsAt: at,
    })
    // The seller changes the price exactly at the boundary instant.
    await setPrice(product.id, 300, at)
    await drainMarkers()
    await materializeDuePredictions(prisma, { now: at, productIds: [product.id] })
    const rows = await loadKeyTimeline(prisma, `product:${product.id}`, new Date(at.getTime() - 1), at)
    expect(rows.filter((row) => row.recordedAt.getTime() === at.getTime())).toHaveLength(2)
    expect(effectiveTimeline(rows, at).at(-1)!.price.toString()).toBe('270')
    expect(await prisma.priceDropEvent.count({ where: { productId: product.id } })).toBe(0)
  })

  it('parallel writes and a parallel reconcile leave no stale row and no reset', async () => {
    const seller = await seedSeller()
    const product = await createProduct(seller.id, 100)
    await drainMarkers()
    const prices = [101, 102, 103, 104, 105, 106, 107, 108]
    await Promise.all([
      ...prices.map((price) => setPrice(product.id, price)),
      reconcilePriceHistory(prisma),
      reconcilePriceHistory(prisma),
    ])
    await drainMarkers()
    const current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } })
    const valid = (await history(product.id)).filter((row) => !row.cancelledAt)
    expect(valid.at(-1)!.price.toString()).toBe(current.price.toString())
    expect(await prisma.priceKeyTracking.count({ where: { productId: product.id, lastResetReason: { not: null } } })).toBe(0)
  })

  it('three parallel baselines write one baseline row per key', async () => {
    const seller = await seedSeller()
    const product = await prisma.product.create({
      data: { sellerId: seller.id, slug: `u-${randomUUID().slice(0, 16)}`, name: 'Yeni', status: 'published', price: new Decimal(50), stockQuantity: 1 },
    })
    await markAllMarkersProcessed()
    await Promise.all([baselineUntrackedProducts(prisma), baselineUntrackedProducts(prisma), baselineUntrackedProducts(prisma)])
    expect(await prisma.productPriceHistory.count({ where: { productId: product.id, source: 'baseline', cancelledAt: null } })).toBe(1)
    expect(await prisma.priceKeyTracking.count({ where: { productId: product.id } })).toBe(1)
  })
})

// ── Decision, dispatch and the send gate ────────────────────────────────────

async function eligibleDropScenario(options: { variants?: number[] } = {}) {
  // The dispatcher takes the oldest open event; close earlier tests' events so each test
  // observes only its own.
  await prisma.priceDropEvent.updateMany({
    where: { status: { in: ['candidate', 'pending', 'dispatching'] } },
    data: { status: 'cancelled', reason: 'test_isolation' },
  })
  const seller = await seedSeller()
  const product = await createProduct(seller.id, 100, { at: new Date(Date.now() - 20 * DAY), ...(options.variants ? { variants: options.variants } : {}) })
  const fan = await seedUser()
  return { seller, product, fan }
}

describe('decision and dispatch', () => {
  it('an unprocessed marker holds the decision until it is processed', async () => {
    const { product, fan } = await eligibleDropScenario()
    await favorite(fan.id, product.id)
    await setPrice(product.id, 90)
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    expect((await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })).status).toBe('candidate')
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    expect((await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })).status).toBe('pending')
  })

  it('freezes favoriters only; store followers, the seller, other roles and non-consenting users are left out', async () => {
    const { seller, product, fan } = await eligibleDropScenario()
    const noConsent = await seedUser({ consent: false })
    const followerOnly = await seedUser()
    const both = await seedUser()
    const admin = await seedUser({ role: 'admin' })
    for (const user of [fan, noConsent, both, admin]) await favorite(user.id, product.id)
    await favorite(seller.userId, product.id)
    for (const user of [followerOnly, both]) {
      await prisma.storeFollow.create({ data: { userId: user.id, sellerId: seller.id, emailOptOutToken: randomUUID() } })
    }

    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    await dispatchUntilDone(product.id)

    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })
    expect(event).toMatchObject({ status: 'dispatched', recipientCount: 2 })
    const recipients = await prisma.priceDropRecipient.findMany({ where: { eventId: event.id } })
    const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]))
    expect(byUser.get(fan.id)?.status).toBe('reserved')
    expect(byUser.get(both.id)?.status).toBe('reserved')
    expect(byUser.get(noConsent.id)).toMatchObject({ status: 'skipped', skipReason: 'no_consent' })
    expect(byUser.has(followerOnly.id)).toBe(false)
    expect(byUser.has(admin.id)).toBe(false)
    expect(byUser.has(seller.userId)).toBe(false)
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: `price-drop:${event.id}:` } } })).toBe(2)

    // New favoriters after the freeze are not added to this event.
    const late = await seedUser()
    await favorite(late.id, product.id)
    await dispatchUntilDone(product.id)
    expect(await prisma.priceDropRecipient.count({ where: { eventId: event.id, userId: late.id } })).toBe(0)

    // The send gate lets it through and the reservation becomes `sent`.
    await dispatchOutbox(`price-drop:${event.id}:user:${fan.id}`)
    expect(h.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'Favorilediğiniz ürün son 15 günün en düşük fiyatında', fromCategory: 'kampanya' }),
    )
    const reservation = await prisma.campaignEmailDispatch.findFirstOrThrow({ where: { eventKey: `price-drop:${event.id}:user:${fan.id}` } })
    expect(reservation.status).toBe('sent')
  })

  it('an unexplained change while queued resets trust at the gate: nothing is sent', async () => {
    const { product, fan } = await eligibleDropScenario()
    await favorite(fan.id, product.id)
    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    await dispatchUntilDone(product.id)
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })

    await prisma.$executeRawUnsafe(`UPDATE products SET price = 90.5 WHERE id = $1`, product.id)
    await prisma.$executeRawUnsafe(`UPDATE products SET price = 90 WHERE id = $1`, product.id)

    await dispatchOutbox(`price-drop:${event.id}:user:${fan.id}`)
    expect(h.send).not.toHaveBeenCalled()
    // The audience was already fully queued, so the event stays `dispatched`; its queued
    // reservations are what the reset releases.
    expect((await prisma.priceDropEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('dispatched')
    expect(
      await prisma.campaignEmailDispatch.findFirstOrThrow({ where: { eventKey: `price-drop:${event.id}:user:${fan.id}` } }),
    ).toMatchObject({ status: 'released', releaseReason: 'history_reset' })
  })

  it('a reset while recipients still wait cancels the event and skips them', async () => {
    const { product, fan } = await eligibleDropScenario()
    const other = await seedUser()
    await favorite(fan.id, product.id)
    await favorite(other.id, product.id)
    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    const inFlight = await prisma.notificationOutbox.count({ where: { lane: 'bulk', status: { in: ['pending', 'queued'] } } })
    await advancePriceDropDispatch(prisma, { cap: inFlight + 1 })
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })
    expect(event.status).toBe('dispatching')

    await prisma.$executeRawUnsafe(`UPDATE products SET price = 91 WHERE id = $1`, product.id)
    await drainMarkers()
    expect(await prisma.priceDropEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({
      status: 'cancelled',
      reason: 'history_reset',
    })
    const recipients = await prisma.priceDropRecipient.findMany({ where: { eventId: event.id } })
    expect(recipients.every((recipient) => recipient.status !== 'awaiting_capacity')).toBe(true)
    expect(recipients.some((recipient) => recipient.skipReason === 'history_reset')).toBe(true)
    expect(
      await prisma.campaignEmailDispatch.count({ where: { discountFingerprint: `price-drop:${event.id}`, status: 'reserved' } }),
    ).toBe(0)
  })

  it('a price that went lower and came back is no longer "the lowest" at send time', async () => {
    const { product, fan } = await eligibleDropScenario()
    await favorite(fan.id, product.id)
    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    await dispatchUntilDone(product.id)
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id, status: 'dispatched' } })

    await setPrice(product.id, 80)
    await setPrice(product.id, 90)
    await dispatchOutbox(`price-drop:${event.id}:user:${fan.id}`)
    expect(h.send).not.toHaveBeenCalled()
    expect(
      await prisma.campaignEmailDispatch.findFirstOrThrow({ where: { eventKey: `price-drop:${event.id}:user:${fan.id}` } }),
    ).toMatchObject({ status: 'released', releaseReason: 'above_window_min' })
  })

  it('a recipient refused by the daily cap is skipped for good; capacity only delays', async () => {
    const { product, fan } = await eligibleDropScenario()
    const other = await seedUser()
    await favorite(fan.id, product.id)
    await favorite(other.id, product.id)
    for (const index of [1, 2, 3]) {
      await prisma.campaignEmailDispatch.create({
        data: {
          userId: fan.id,
          productId: `other-${index}`,
          discountFingerprint: `past-${randomUUID()}`,
          source: 'cart',
          status: 'sent',
          sentAt: new Date(Date.now() - index * 60 * MIN),
        },
      })
    }
    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })

    // Room for one outbox row only: nobody is dropped for capacity, they wait.
    const inFlight = await prisma.notificationOutbox.count({ where: { lane: 'bulk', status: { in: ['pending', 'queued'] } } })
    await advancePriceDropDispatch(prisma, { cap: inFlight + 1 })
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })
    let recipients = await prisma.priceDropRecipient.findMany({ where: { eventId: event.id }, orderBy: { id: 'asc' } })
    expect(recipients.filter((recipient) => recipient.status === 'awaiting_capacity')).toHaveLength(1)

    await advancePriceDropDispatch(prisma, { cap: inFlight + 10 })
    recipients = await prisma.priceDropRecipient.findMany({ where: { eventId: event.id } })
    const byUser = new Map(recipients.map((recipient) => [recipient.userId, recipient]))
    expect(byUser.get(fan.id)).toMatchObject({ status: 'skipped', skipReason: 'daily_cap' })
    expect(byUser.get(other.id)?.status).toBe('reserved')
    expect((await prisma.priceDropEvent.findUniqueOrThrow({ where: { id: event.id } })).status).toBe('dispatched')

    // Next day: the skipped recipient is not retried for this event.
    await advancePriceDropDispatch(prisma, { now: new Date(Date.now() + 2 * DAY) })
    expect((await prisma.priceDropRecipient.findFirstOrThrow({ where: { eventId: event.id, userId: fan.id } })).status).toBe('skipped')
  })

  it('parallel dispatch ticks reserve every recipient exactly once', async () => {
    const { product } = await eligibleDropScenario()
    const fans = await Promise.all(Array.from({ length: 12 }, () => seedUser()))
    for (const fan of fans) await favorite(fan.id, product.id)
    await setPrice(product.id, 90)
    await drainMarkers()
    await evaluatePriceDropCandidates(prisma, { productIds: [product.id] })
    for (let round = 0; round < 4; round += 1) {
      await Promise.all([advancePriceDropDispatch(prisma), advancePriceDropDispatch(prisma), advancePriceDropDispatch(prisma)])
    }
    const event = await prisma.priceDropEvent.findFirstOrThrow({ where: { productId: product.id } })
    expect(await prisma.priceDropRecipient.count({ where: { eventId: event.id, status: 'reserved' } })).toBe(12)
    expect(await prisma.campaignEmailDispatch.count({ where: { discountFingerprint: `price-drop:${event.id}` } })).toBe(12)
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: `price-drop:${event.id}:` } } })).toBe(12)
  })
})

describe('shared limits at send time', () => {
  it('two campaign e-mails for the same user at the same moment cannot pass the 3-in-24h limit together', async () => {
    const user = await seedUser()
    for (const index of [1, 2]) {
      await prisma.campaignEmailDispatch.create({
        data: {
          userId: user.id,
          productId: `sent-${index}`,
          discountFingerprint: `sent-${randomUUID()}`,
          source: 'cart',
          status: 'sent',
          sentAt: new Date(Date.now() - index * MIN),
        },
      })
    }
    const keys = ['a', 'b'].map((suffix) => `campaign-cart:gate-${randomUUID()}:user:${user.id}:${suffix}`)
    for (const [index, eventKey] of keys.entries()) {
      await prisma.$transaction((tx) =>
        reserveCampaignEmail(tx, {
          userId: user.id,
          productId: `queued-${index}`,
          source: 'cart',
          fingerprint: `fp-${randomUUID()}`,
          eventKey,
          now: new Date(),
        }),
      )
    }
    const results = await Promise.all(
      keys.map((eventKey) => runCampaignSendGate(prisma, { type: 'product_discount_in_cart', eventKey, userId: user.id })),
    )
    expect(results.filter((result) => result.proceed)).toHaveLength(1)
    expect(results.find((result) => !result.proceed)).toEqual({ proceed: false, reason: 'CAMPAIGN_RELEASED:daily_cap' })
  })

  it('a lowest-price reservation releases a queued cart reservation for the same product', async () => {
    const user = await seedUser()
    const now = new Date()
    const cart = await prisma.$transaction((tx) =>
      reserveCampaignEmail(tx, { userId: user.id, productId: 'p-prio', source: 'cart', fingerprint: `c-${randomUUID()}`, eventKey: `k-${randomUUID()}`, now }),
    )
    const drop = await prisma.$transaction((tx) =>
      reserveCampaignEmail(tx, { userId: user.id, productId: 'p-prio', source: 'price_drop', fingerprint: `price-drop:${randomUUID()}`, eventKey: `k-${randomUUID()}`, now }),
    )
    expect(cart.ok && drop.ok).toBe(true)
    const cartRow = await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { id: (cart as { id: string }).id } })
    expect(cartRow).toMatchObject({ status: 'released', releaseReason: 'superseded_by_price_drop' })
  })
})

// Guard: a type the Prisma client does not know about would make every assertion vacuous.
it('uses the price drop notification type known to the client', () => {
  const value: Prisma.NotificationOutboxCreateInput['type'] = 'product_price_drop'
  expect(value).toBe('product_price_drop')
})
