/**
 * Price change markers and reconciliation (e-mail plan phase 6).
 *
 * Database triggers write a marker for every price-relevant change. The application recorder
 * writes an explanation for what it recorded in the same transaction. Here:
 *
 *   - a marker with a matching explanation is `explained`;
 *   - a marker without one is an unexplained change (seed, CLI, SQL, manual edit, a code path
 *     without the hook). The affected price keys lose their trust: valid rows after the change
 *     are cancelled, the current price is written as a `reconcile` row, `trackedSince` becomes
 *     now and open price drop work for those products is abandoned. The keys wait 15 days again.
 *
 * All marker processing runs under one global advisory lock, so the tick and the send gate
 * (which processes the markers of one product inline) never process the same marker twice.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  computeKeyPrices,
  loadProductsForPricing,
  loadRulesForSellers,
  lockProductsForPriceHistory,
  PRICE_HISTORY_LOCK_PREFIX,
  PRICE_HISTORY_WRITE_TX_OPTIONS,
  recordPriceChanges,
} from './price-history.service'

type Tx = Prisma.TransactionClient

const MARKER_LOCK_NAME = 'hanuja:price-change-markers'

interface MarkerRow {
  id: bigint
  entity: string
  productId: string | null
  sellerId: string | null
  ruleId: string | null
  txId: bigint
  changedAt: Date
}

export interface MarkerScope {
  productIds?: readonly string[]
  sellerIds?: readonly string[]
}

export interface ProcessMarkersResult {
  explained: number
  reset: number
  ignored: number
  resetProducts: number
}

function isExplained(marker: MarkerRow, explained: Set<string>) {
  const tx = marker.txId.toString()
  const productKey = marker.productId ? `${tx}|product|${marker.productId}` : null
  const ruleKey = marker.ruleId ? `${tx}|rule|${marker.ruleId}` : null
  if (marker.entity === 'product' || marker.entity === 'variant') return Boolean(productKey && explained.has(productKey))
  if (marker.entity === 'rule') return Boolean(ruleKey && explained.has(ruleKey))
  // rule_product: written by a rule change or by a product delete cascade.
  return Boolean((ruleKey && explained.has(ruleKey)) || (productKey && explained.has(productKey)))
}

/**
 * Processes unprocessed markers (optionally only those of some products/sellers) in id order.
 * Returns once the batch is done; call again while it keeps finding markers.
 */
export async function processPriceChangeMarkers(
  prisma: PrismaClient,
  options: { now?: Date; limit?: number; scope?: MarkerScope } = {},
): Promise<ProcessMarkersResult> {
  const limit = options.limit ?? 500
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${MARKER_LOCK_NAME}))`)
    const now = options.now ?? new Date()
    const scopeProducts = options.scope?.productIds ? [...options.scope.productIds] : null
    const scopeSellers = options.scope?.sellerIds ? [...options.scope.sellerIds] : null
    const scopeFilter =
      scopeProducts || scopeSellers
        ? Prisma.sql`AND ("productId" = ANY(${scopeProducts ?? []}::text[]) OR "sellerId" = ANY(${scopeSellers ?? []}::text[]))`
        : Prisma.empty
    const markers = await tx.$queryRaw<MarkerRow[]>(Prisma.sql`
      SELECT id, entity, "productId", "sellerId", "ruleId", "txId", "changedAt"
      FROM price_change_markers
      WHERE "processedAt" IS NULL ${scopeFilter}
      ORDER BY id
      LIMIT ${limit}
    `)
    const result: ProcessMarkersResult = { explained: 0, reset: 0, ignored: 0, resetProducts: 0 }
    if (!markers.length) return result

    const explanations = await tx.priceChangeExplanation.findMany({
      where: { txId: { in: [...new Set(markers.map((marker) => marker.txId))] } },
      select: { txId: true, entityType: true, entityId: true },
    })
    const explained = new Set(explanations.map((row) => `${row.txId.toString()}|${row.entityType}|${row.entityId}`))

    const explainedIds: bigint[] = []
    const unexplained: MarkerRow[] = []
    for (const marker of markers) {
      if (isExplained(marker, explained)) explainedIds.push(marker.id)
      else unexplained.push(marker)
    }
    if (explainedIds.length) {
      await tx.priceChangeMarker.updateMany({
        where: { id: { in: explainedIds } },
        data: { processedAt: now, outcome: 'explained' },
      })
      result.explained = explainedIds.length
    }
    if (!unexplained.length) return result

    // Affected products: the product of a product/variant/rule_product marker (adding or
    // removing one product from a PRODUCT-scope rule changes only that product); every product of
    // the seller for a rule marker (the rule's scope before the change is unknown — stay
    // conservative). A product that no longer exists (a delete and its cascades) is ignored.
    const productIdsDirect = new Set<string>()
    const sellerIds = new Set<string>()
    const ruleIdsWithoutSeller = new Set<string>()
    for (const marker of unexplained) {
      if (marker.entity === 'rule') {
        if (marker.sellerId) sellerIds.add(marker.sellerId)
        else if (marker.ruleId) ruleIdsWithoutSeller.add(marker.ruleId)
      } else if (marker.productId) {
        productIdsDirect.add(marker.productId)
      }
    }
    if (ruleIdsWithoutSeller.size) {
      const rules = await tx.discountRule.findMany({
        where: { id: { in: [...ruleIdsWithoutSeller] } },
        select: { sellerId: true },
      })
      for (const rule of rules) sellerIds.add(rule.sellerId)
    }
    const sellerProducts = sellerIds.size
      ? await tx.product.findMany({ where: { sellerId: { in: [...sellerIds] } }, select: { id: true } })
      : []
    const existing = await tx.product.findMany({
      where: { id: { in: [...productIdsDirect, ...sellerProducts.map((row) => row.id)] } },
      select: { id: true },
    })
    const productIds = existing.map((row) => row.id)

    if (productIds.length) {
      await lockProductsForPriceHistory(tx, productIds)
      const earliest = unexplained.reduce(
        (min, marker) => (marker.changedAt < min ? marker.changedAt : min),
        unexplained[0]!.changedAt,
      )
      // Rows after the unexplained change describe data that is no longer known to be right.
      await tx.productPriceHistory.updateMany({
        where: { productId: { in: productIds }, cancelledAt: null, recordedAt: { gt: earliest } },
        data: { cancelledAt: now, cancelReason: 'unexplained_change' },
      })
      await recordPriceChanges(tx, {
        productIds,
        source: 'reconcile',
        now,
        resetTrust: { reason: 'unexplained_change' },
        skipLock: true,
      })
      console.warn(
        `[price-history] unexplained change: ${unexplained.length} marker(s), ${productIds.length} product(s) reset`,
      )
    }
    await tx.priceChangeMarker.updateMany({
      where: { id: { in: unexplained.map((marker) => marker.id) } },
      data: { processedAt: now, outcome: productIds.length ? 'reset' : 'ignored' },
    })
    if (productIds.length) {
      result.reset = unexplained.length
      result.resetProducts = productIds.length
    } else {
      result.ignored = unexplained.length
    }
    return result
  }, PRICE_HISTORY_WRITE_TX_OPTIONS)
}

/** True while an unprocessed marker concerns the product or its seller. */
export async function hasPendingMarkers(client: PrismaClient | Tx, productId: string, sellerId: string) {
  const count = await client.priceChangeMarker.count({
    where: { processedAt: null, OR: [{ productId }, { sellerId }] },
  })
  return count > 0
}

/**
 * Baseline for products that have no tracked price key yet: the first ever run after deploy,
 * and any product created by a path without the hook. Also writes the future rule boundaries.
 */
export async function baselineUntrackedProducts(prisma: PrismaClient, options: { now?: Date; limit?: number } = {}) {
  const limit = options.limit ?? 200
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM price_key_tracking t WHERE t."productId" = p.id)
    ORDER BY p.id
    LIMIT ${limit}
  `)
  if (!rows.length) return 0
  await prisma.$transaction(
    (tx) =>
      recordPriceChanges(tx, {
        productIds: rows.map((row) => row.id),
        source: 'baseline',
        ...(options.now ? { now: options.now } : {}),
      }),
    PRICE_HISTORY_WRITE_TX_OPTIONS,
  )
  return rows.length
}

/**
 * Hourly safety net: the latest valid row of every key must equal the price computed from the
 * current data. A difference means a hook recorded something wrong; the key's trust is reset.
 * Products locked by a writer right now are skipped (the writer records them).
 */
export async function reconcilePriceHistory(prisma: PrismaClient, options: { now?: Date; batchSize?: number } = {}) {
  const batchSize = options.batchSize ?? 200
  let cursor: string | undefined
  let checked = 0
  let mismatched = 0
  for (;;) {
    const page = await prisma.product.findMany({
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (!page.length) break
    cursor = page[page.length - 1]!.id
    const batchMismatches = await prisma.$transaction(async (tx) => {
      const now = options.now ?? new Date()
      const locked = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT s.id FROM (SELECT id FROM unnest(${page.map((row) => row.id)}::text[]) AS t(id) ORDER BY id) s
        WHERE pg_try_advisory_xact_lock(hashtext(${PRICE_HISTORY_LOCK_PREFIX} || s.id))
      `)
      const ids = locked.map((row) => row.id)
      const products = await loadProductsForPricing(tx, ids)
      const rules = await loadRulesForSellers(tx, products.map((product) => product.sellerId))
      const latest = await tx.$queryRaw<{ priceKey: string; price: Prisma.Decimal }[]>(Prisma.sql`
        SELECT DISTINCT ON ("priceKey") "priceKey", price
        FROM product_price_history
        WHERE "productId" = ANY(${ids}::text[]) AND "cancelledAt" IS NULL AND "recordedAt" <= ${now}
        ORDER BY "priceKey", "recordedAt" DESC, seq DESC
      `)
      const latestByKey = new Map(latest.map((row) => [row.priceKey, new Decimal(row.price.toString())]))
      const mismatchedIds: string[] = []
      for (const product of products) {
        const prices = computeKeyPrices(product, rules, now)
        const tracked = prices.some((entry) => latestByKey.has(entry.key.priceKey))
        if (!tracked) continue // untracked products get their baseline in the tick
        if (prices.some((entry) => !latestByKey.get(entry.key.priceKey)?.eq(entry.price))) {
          mismatchedIds.push(product.id)
        }
      }
      if (mismatchedIds.length) {
        await recordPriceChanges(tx, {
          productIds: mismatchedIds,
          source: 'reconcile',
          now,
          resetTrust: { reason: 'reconcile_mismatch' },
          skipLock: true,
        })
        console.warn(`[price-history] reconcile mismatch: ${mismatchedIds.length} product(s) reset`)
      }
      checked += products.length
      return mismatchedIds.length
    }, PRICE_HISTORY_WRITE_TX_OPTIONS)
    mismatched += batchMismatches
    if (page.length < batchSize) break
  }
  return { checked, mismatched }
}

/** Manual reset (after a database restore, or on request). */
export async function resetPriceHistoryTrust(
  prisma: PrismaClient,
  scope: { productIds?: readonly string[]; sellerIds?: readonly string[]; all?: boolean },
  reason: string,
) {
  const where: Prisma.ProductWhereInput = scope.all
    ? {}
    : {
        OR: [
          ...(scope.productIds?.length ? [{ id: { in: [...scope.productIds] } }] : []),
          ...(scope.sellerIds?.length ? [{ sellerId: { in: [...scope.sellerIds] } }] : []),
        ],
      }
  if (!scope.all && !scope.productIds?.length && !scope.sellerIds?.length) return 0
  const products = await prisma.product.findMany({ where, select: { id: true }, orderBy: { id: 'asc' } })
  const ids = products.map((row) => row.id)
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200)
    await prisma.$transaction(
      (tx) => recordPriceChanges(tx, { productIds: chunk, source: 'reconcile', resetTrust: { reason } }),
      PRICE_HISTORY_WRITE_TX_OPTIONS,
    )
  }
  return ids.length
}
