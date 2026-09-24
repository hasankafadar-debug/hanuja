/**
 * Price history recorder (e-mail plan phase 6).
 *
 * Every application write that can change an effective price calls `recordPriceChanges` inside
 * its own transaction. The recorder:
 *   1. serialises writers per product with a transaction-scoped advisory lock,
 *   2. states in price_change_explanations what it recorded (the triggers' markers for this
 *      transaction are then "explained"; anything else resets trust — see
 *      price-change-reconcile.service.ts),
 *   3. writes the price at `now` for every changed price key,
 *   4. cancels future predictions and writes the rule start/end boundaries ahead as `predicted`
 *      rows with their exact times, so the history of a campaign never depends on a worker
 *      running at that moment,
 *   5. records a `candidate` price drop event for every drop at `now`.
 *
 * Nothing here decides whether a drop is announced: price-drop-evaluation does that after the
 * markers are processed.
 */
import { Prisma, type PriceHistorySource, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  applyEffectivePricing,
  buildPriceKeySources,
  computeEffectivePrice,
  isRuleInScope,
  ruleBoundaryInstants,
  type DiscountRuleLike,
  type PriceKeySource,
} from '../domain/effective-price'

type Tx = Prisma.TransactionClient
type DbClient = Tx | PrismaClient

export const PRICE_HISTORY_LOCK_PREFIX = 'price-history:'

export interface RecordPriceChangesOptions {
  productIds: readonly string[]
  /** Discount rules written in this transaction (explains their markers). */
  ruleIds?: readonly string[]
  source: PriceHistorySource
  now?: Date
  /**
   * Reconcile mode: the key's trust is reset to `now` and a row is written for every key even
   * when the price did not change, so every window starting after the reset has a known price.
   */
  resetTrust?: { reason: string }
  /** The caller already holds the product locks. */
  skipLock?: boolean
}

export interface RecordPriceChangesResult {
  rowsWritten: number
  predictedWritten: number
  candidates: number
}

interface LatestRow {
  priceKey: string
  price: Prisma.Decimal
  recordedAt: Date
  seq: bigint
}

export interface ProductPricingSnapshot {
  id: string
  sellerId: string
  categoryId: string | null
  price: Decimal
  compareAtPrice: Decimal | null
  stockQuantity: number
  status: string
  seller: { status: string; vacationModeEnabled: boolean; userId: string }
  variants: Array<{ id: string; price: Decimal | null; stockQuantity: number; name: string }>
}

/** Blocking, ordered locks: the same order everywhere keeps concurrent writers deadlock-free. */
export async function lockProductsForPriceHistory(tx: Tx, productIds: readonly string[]) {
  const ids = [...new Set(productIds)].sort()
  if (!ids.length) return
  await tx.$queryRaw(Prisma.sql`
    SELECT COUNT(*)::int AS n
    FROM (SELECT DISTINCT id FROM unnest(${ids}::text[]) AS t(id) ORDER BY id) s
    CROSS JOIN LATERAL (SELECT pg_advisory_xact_lock(hashtext(${PRICE_HISTORY_LOCK_PREFIX} || s.id))) l
  `)
}

export async function currentTxId(tx: Tx): Promise<bigint> {
  const [row] = await tx.$queryRaw<{ tx: bigint }[]>(Prisma.sql`SELECT txid_current()::bigint AS tx`)
  if (!row) throw new Error('PRICE_HISTORY_TXID_UNAVAILABLE')
  return BigInt(row.tx)
}

export async function loadProductsForPricing(
  client: DbClient,
  productIds: readonly string[],
): Promise<ProductPricingSnapshot[]> {
  if (!productIds.length) return []
  const rows = await client.product.findMany({
    where: { id: { in: [...productIds] } },
    select: {
      id: true,
      sellerId: true,
      categoryId: true,
      price: true,
      compareAtPrice: true,
      stockQuantity: true,
      status: true,
      seller: { select: { status: true, vacationModeEnabled: true, userId: true } },
      variants: {
        select: { id: true, price: true, stockQuantity: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
    },
  })
  return rows as unknown as ProductPricingSnapshot[]
}

/** Rules that can apply now or later (PAUSED/EXPIRED never apply; loaded like resolveEffectivePrices). */
export async function loadRulesForSellers(client: DbClient, sellerIds: readonly string[]): Promise<DiscountRuleLike[]> {
  if (!sellerIds.length) return []
  const rules = await client.discountRule.findMany({
    where: { sellerId: { in: [...new Set(sellerIds)] }, status: { in: ['ACTIVE', 'SCHEDULED', 'PAUSED'] } },
    include: { products: { select: { productId: true } } },
  })
  return rules as unknown as DiscountRuleLike[]
}

/** Is this key purchasable right now (storefront visibility + stock)? */
export function isKeySellable(product: ProductPricingSnapshot, key: PriceKeySource) {
  return (
    product.status === 'published' &&
    product.seller.status === 'active' &&
    !product.seller.vacationModeEnabled &&
    key.stockQuantity > 0
  )
}

export interface KeyPrice {
  key: PriceKeySource
  price: Decimal
  discountRuleId: string | null
}

export function computeKeyPrices(
  product: ProductPricingSnapshot,
  rules: DiscountRuleLike[],
  at: Date,
): KeyPrice[] {
  const productRules = rules.filter((rule) => isRuleInScope(rule, product))
  const pricing = computeEffectivePrice(product, productRules, at)
  return buildPriceKeySources(product, product.variants).map((key) => ({
    key,
    price: applyEffectivePricing(key.basePrice, pricing),
    discountRuleId: pricing.discountSource?.ruleId ?? null,
  }))
}

async function loadLatestValidRows(tx: Tx, productIds: readonly string[], at: Date): Promise<Map<string, LatestRow>> {
  if (!productIds.length) return new Map()
  const rows = await tx.$queryRaw<LatestRow[]>(Prisma.sql`
    SELECT DISTINCT ON ("priceKey") "priceKey", price, "recordedAt", seq
    FROM product_price_history
    WHERE "productId" = ANY(${[...productIds]}::text[])
      AND "cancelledAt" IS NULL
      AND "recordedAt" <= ${at}
    ORDER BY "priceKey", "recordedAt" DESC, seq DESC
  `)
  return new Map(rows.map((row) => [row.priceKey, row]))
}

/**
 * Open price drop work that relied on the old history is abandoned: unfinished events are
 * cancelled, recipients still waiting for capacity are skipped, and every reservation still
 * queued — also those of events whose audience was already fully queued (`dispatched`) — is
 * released. E-mails already sent stay as they are.
 */
export async function cancelOpenPriceDropWork(tx: Tx, productIds: readonly string[], reason: string, now: Date) {
  if (!productIds.length) return 0
  const events = await tx.priceDropEvent.findMany({
    where: {
      productId: { in: [...productIds] },
      status: { in: ['candidate', 'pending', 'dispatching', 'dispatched'] },
    },
    select: { id: true, status: true },
  })
  if (!events.length) return 0
  const openIds = events.filter((event) => event.status !== 'dispatched').map((event) => event.id)
  if (openIds.length) {
    await tx.priceDropEvent.updateMany({
      where: { id: { in: openIds } },
      data: { status: 'cancelled', reason, completedAt: now },
    })
    await tx.priceDropRecipient.updateMany({
      where: { eventId: { in: openIds }, status: 'awaiting_capacity' },
      data: { status: 'skipped', skipReason: reason },
    })
  }
  await tx.campaignEmailDispatch.updateMany({
    where: {
      discountFingerprint: { in: events.map((event) => priceDropFingerprint(event.id)) },
      status: 'reserved',
    },
    data: { status: 'released', releaseReason: reason },
  })
  return events.length
}

export function priceDropFingerprint(eventId: string) {
  return `price-drop:${eventId}`
}

export async function recordPriceChanges(tx: Tx, options: RecordPriceChangesOptions): Promise<RecordPriceChangesResult> {
  const now = options.now ?? new Date()
  const productIds = [...new Set(options.productIds)].sort()
  const ruleIds = [...new Set(options.ruleIds ?? [])]
  if (!options.skipLock) await lockProductsForPriceHistory(tx, productIds)

  const txId = await currentTxId(tx)
  const explanations = [
    ...productIds.map((id) => ({ txId, entityType: 'product', entityId: id })),
    ...ruleIds.map((id) => ({ txId, entityType: 'rule', entityId: id })),
  ]
  if (explanations.length) {
    await tx.priceChangeExplanation.createMany({ data: explanations, skipDuplicates: true })
  }
  if (!productIds.length) return { rowsWritten: 0, predictedWritten: 0, candidates: 0 }

  const products = await loadProductsForPricing(tx, productIds)
  if (!products.length) return { rowsWritten: 0, predictedWritten: 0, candidates: 0 }
  const rules = await loadRulesForSellers(
    tx,
    products.map((product) => product.sellerId),
  )
  const presentIds = products.map((product) => product.id)

  // Predictions after `now` were computed from older data: never valid any more.
  await tx.productPriceHistory.updateMany({
    where: { productId: { in: presentIds }, cancelledAt: null, recordedAt: { gt: now } },
    data: { cancelledAt: now, cancelReason: options.resetTrust ? options.resetTrust.reason : 'superseded' },
  })

  const latest = await loadLatestValidRows(tx, presentIds, now)
  const existingTracking = await tx.priceKeyTracking.findMany({
    where: { productId: { in: presentIds } },
    select: { priceKey: true },
  })
  const tracked = new Set(existingTracking.map((row) => row.priceKey))

  type NewRow = Prisma.ProductPriceHistoryCreateManyInput
  const immediate: NewRow[] = []
  const drops = new Map<string, Decimal>() // priceKey -> previous price
  const predicted: NewRow[] = []
  const trackingRows: Prisma.PriceKeyTrackingCreateManyInput[] = []

  for (const product of products) {
    const nowPrices = computeKeyPrices(product, rules, now)
    for (const { key, price, discountRuleId } of nowPrices) {
      const last = latest.get(key.priceKey)
      const changed = !last || !new Decimal(last.price.toString()).eq(price)
      if (changed || options.resetTrust) {
        immediate.push({
          productId: product.id,
          sellerId: product.sellerId,
          variantId: key.variantId,
          priceKey: key.priceKey,
          price,
          basePrice: key.basePrice,
          discountRuleId,
          source: options.source,
          recordedAt: now,
          predicted: false,
          materializedAt: now,
          txId,
        })
        if (last && price.lt(new Decimal(last.price.toString()))) {
          drops.set(key.priceKey, new Decimal(last.price.toString()))
        }
      }
      if (!tracked.has(key.priceKey)) {
        trackingRows.push({
          priceKey: key.priceKey,
          productId: product.id,
          variantId: key.variantId,
          trackedSince: now,
        })
        tracked.add(key.priceKey)
      }
    }

    // Rule boundaries ahead of time, with their exact instants.
    const productRules = rules.filter((rule) => isRuleInScope(rule, product))
    let previous = new Map(nowPrices.map((entry) => [entry.key.priceKey, entry.price]))
    for (const instant of ruleBoundaryInstants(productRules, now)) {
      const atInstant = computeKeyPrices(product, rules, instant)
      const next = new Map<string, Decimal>()
      for (const { key, price, discountRuleId } of atInstant) {
        next.set(key.priceKey, price)
        const before = previous.get(key.priceKey)
        if (before && before.eq(price)) continue
        predicted.push({
          productId: product.id,
          sellerId: product.sellerId,
          variantId: key.variantId,
          priceKey: key.priceKey,
          price,
          basePrice: key.basePrice,
          discountRuleId,
          source: 'rule_boundary',
          recordedAt: instant,
          predicted: true,
          txId,
        })
      }
      previous = next
    }
  }

  if (options.resetTrust) {
    const keys = products.flatMap((product) => buildPriceKeySources(product, product.variants).map((key) => key.priceKey))
    if (keys.length) {
      await tx.priceKeyTracking.updateMany({
        where: { priceKey: { in: keys } },
        data: { trackedSince: now, lastResetAt: now, lastResetReason: options.resetTrust.reason },
      })
    }
    await cancelOpenPriceDropWork(tx, presentIds, 'history_reset', now)
  }
  if (trackingRows.length) {
    await tx.priceKeyTracking.createMany({ data: trackingRows, skipDuplicates: true })
  }

  let candidates = 0
  if (immediate.length) {
    const inserted = await tx.productPriceHistory.createManyAndReturn({
      data: immediate,
      select: { seq: true, priceKey: true, productId: true, sellerId: true, variantId: true, price: true, recordedAt: true },
    })
    const candidateRows = inserted
      .filter((row) => drops.has(row.priceKey))
      .map((row) => ({
        historySeq: row.seq,
        productId: row.productId,
        sellerId: row.sellerId,
        priceKey: row.priceKey,
        variantId: row.variantId,
        previousPrice: drops.get(row.priceKey)!,
        newPrice: row.price,
        changeAt: row.recordedAt,
      }))
    if (candidateRows.length && !options.resetTrust) {
      await tx.priceDropEvent.createMany({ data: candidateRows, skipDuplicates: true })
      candidates = candidateRows.length
    }
  }
  if (predicted.length) {
    await tx.productPriceHistory.createMany({ data: predicted })
  }

  return { rowsWritten: immediate.length, predictedWritten: predicted.length, candidates }
}

/** All product ids of a discount rule's scope (a seller's whole catalogue for ALL_PRODUCTS). */
export async function productIdsInRuleScope(
  client: DbClient,
  rule: { sellerId: string; scope: string; categoryId: string | null; productIds: readonly string[] },
): Promise<string[]> {
  if (rule.scope === 'PRODUCT') {
    if (!rule.productIds.length) return []
    const rows = await client.product.findMany({
      where: { sellerId: rule.sellerId, id: { in: [...rule.productIds] } },
      select: { id: true },
    })
    return rows.map((row) => row.id)
  }
  const rows = await client.product.findMany({
    where: {
      sellerId: rule.sellerId,
      ...(rule.scope === 'CATEGORY' ? { categoryId: rule.categoryId ?? '__none__' } : {}),
    },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

/** Transaction options for writes that may reprice a seller's whole catalogue. */
export const PRICE_HISTORY_WRITE_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const
