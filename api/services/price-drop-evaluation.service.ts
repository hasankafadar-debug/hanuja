/**
 * Price drop candidates → decisions (e-mail plan phase 6).
 *
 *   materializeDuePredictions — predicted rule boundary rows whose time has come are marked as
 *     happened; a drop against the previous valid price becomes a `candidate`.
 *   evaluatePriceDropCandidates — each candidate is checked with the pure eligibility rules
 *     (api/domain/price-drop-eligibility.ts). Products with unprocessed change markers are left
 *     for the next tick: no decision is made while an unexplained change may still reset trust.
 *   evaluateEventNow — the same rules for "now", used before dispatching and at the send gate.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'
import {
  effectiveTimeline,
  evaluatePriceDrop,
  pickPrimaryDrop,
  priceAt,
  PRICE_DROP_WINDOW_MS,
  type PriceDropEvaluation,
  type TimelineRow,
} from '../domain/price-drop-eligibility'
import {
  computeKeyPrices,
  isKeySellable,
  loadProductsForPricing,
  loadRulesForSellers,
  lockProductsForPriceHistory,
  PRICE_HISTORY_WRITE_TX_OPTIONS,
  type ProductPricingSnapshot,
} from './price-history.service'

type Tx = Prisma.TransactionClient
type DbClient = Tx | PrismaClient

interface RawTimelineRow {
  seq: bigint
  recordedAt: Date
  price: Prisma.Decimal
  cancelledAt: Date | null
}

function toTimeline(rows: RawTimelineRow[]): TimelineRow[] {
  return rows.map((row) => ({
    seq: BigInt(row.seq),
    recordedAt: row.recordedAt,
    price: new Decimal(row.price.toString()),
    cancelledAt: row.cancelledAt,
  }))
}

/**
 * Valid rows of one key in [from, to] plus the winning row of the last instant before `from`
 * (the price in effect when the window opens).
 */
export async function loadKeyTimeline(client: DbClient, priceKey: string, from: Date, to: Date): Promise<TimelineRow[]> {
  const rows = await client.$queryRaw<RawTimelineRow[]>(Prisma.sql`
    (SELECT seq, "recordedAt", price, "cancelledAt" FROM product_price_history
      WHERE "priceKey" = ${priceKey} AND "cancelledAt" IS NULL
        AND "recordedAt" >= ${from} AND "recordedAt" <= ${to})
    UNION ALL
    (SELECT seq, "recordedAt", price, "cancelledAt" FROM product_price_history
      WHERE "priceKey" = ${priceKey} AND "cancelledAt" IS NULL AND "recordedAt" < ${from}
      ORDER BY "recordedAt" DESC, seq DESC
      LIMIT 1)
  `)
  return toTimeline(rows)
}

async function loadHistoryRow(client: DbClient, seq: bigint): Promise<TimelineRow | null> {
  const row = await client.productPriceHistory.findUnique({
    where: { seq },
    select: { seq: true, recordedAt: true, price: true, cancelledAt: true },
  })
  if (!row) return null
  return { seq: row.seq, recordedAt: row.recordedAt, price: new Decimal(row.price.toString()), cancelledAt: row.cancelledAt }
}

interface KeyContext {
  product: ProductPricingSnapshot | null
  currentPrice: Decimal | null
  sellable: boolean
  trackedSince: Date | null
}

async function loadKeyContext(client: DbClient, productId: string, priceKey: string, now: Date): Promise<KeyContext> {
  const [product] = await loadProductsForPricing(client, [productId])
  const tracking = await client.priceKeyTracking.findUnique({
    where: { priceKey },
    select: { trackedSince: true },
  })
  if (!product) return { product: null, currentPrice: null, sellable: false, trackedSince: tracking?.trackedSince ?? null }
  const rules = await loadRulesForSellers(client, [product.sellerId])
  const entry = computeKeyPrices(product, rules, now).find((price) => price.key.priceKey === priceKey)
  return {
    product,
    currentPrice: entry?.price ?? null,
    sellable: entry ? isKeySellable(product, entry.key) : false,
    trackedSince: tracking?.trackedSince ?? null,
  }
}

export interface EventForEvaluation {
  historySeq: bigint
  productId: string
  priceKey: string
}

/**
 * Eligibility of an event's drop for a claim made at `at` (the change time when deciding, now
 * when dispatching or sending). A missing product or key is not sellable.
 */
export async function evaluateEventAt(
  client: DbClient,
  event: EventForEvaluation,
  at: Date,
  now: Date,
): Promise<PriceDropEvaluation> {
  const changeRow = await loadHistoryRow(client, event.historySeq)
  if (!changeRow) return { eligible: false, reason: 'cancelled_row', windowMin: null, previousPrice: null }
  const context = await loadKeyContext(client, event.productId, event.priceKey, now)
  const from = new Date(Math.min(at.getTime(), changeRow.recordedAt.getTime()) - PRICE_DROP_WINDOW_MS)
  const rows = await loadKeyTimeline(client, event.priceKey, from, at)
  if (!rows.some((row) => row.seq === changeRow.seq)) rows.push(changeRow)
  return evaluatePriceDrop({
    rows,
    changeRow,
    at,
    now,
    trackedSince: context.trackedSince,
    sellable: context.sellable,
    currentPrice: context.currentPrice ?? new Decimal(-1),
  })
}

export function evaluateEventNow(client: DbClient, event: EventForEvaluation, now = new Date()) {
  return evaluateEventAt(client, event, now, now)
}

/** Predicted rows whose instant has passed become real; drops become candidates. */
export async function materializeDuePredictions(
  prisma: PrismaClient,
  options: { now?: Date; limit?: number; productIds?: readonly string[] } = {},
) {
  const now = options.now ?? new Date()
  const limit = options.limit ?? 500
  return prisma.$transaction(async (tx) => {
    const scope = options.productIds
      ? Prisma.sql`AND "productId" = ANY(${[...options.productIds]}::text[])`
      : Prisma.empty
    const due = await tx.$queryRaw<
      Array<{ seq: bigint; productId: string; sellerId: string; priceKey: string; variantId: string | null; price: Prisma.Decimal; recordedAt: Date }>
    >(Prisma.sql`
      SELECT seq, "productId", "sellerId", "priceKey", "variantId", price, "recordedAt"
      FROM product_price_history
      WHERE predicted AND "materializedAt" IS NULL AND "cancelledAt" IS NULL AND "recordedAt" <= ${now} ${scope}
      ORDER BY "recordedAt", seq
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `)
    let candidates = 0
    for (const row of due) {
      const at = row.recordedAt
      const rows = await loadKeyTimeline(tx, row.priceKey, new Date(at.getTime() - 1), at)
      const timeline = effectiveTimeline(rows, at)
      const winner = timeline[timeline.length - 1]
      if (!winner || winner.seq !== BigInt(row.seq)) continue // shadowed at its instant
      const previous = priceAt(timeline, new Date(at.getTime() - 1))
      const price = new Decimal(row.price.toString())
      if (!previous || !price.lt(previous.price)) continue
      await tx.priceDropEvent.createMany({
        data: [
          {
            historySeq: BigInt(row.seq),
            productId: row.productId,
            sellerId: row.sellerId,
            priceKey: row.priceKey,
            variantId: row.variantId,
            previousPrice: previous.price,
            newPrice: price,
            changeAt: at,
          },
        ],
        skipDuplicates: true,
      })
      candidates += 1
    }
    if (due.length) {
      await tx.productPriceHistory.updateMany({
        where: { seq: { in: due.map((row) => BigInt(row.seq)) } },
        data: { materializedAt: now },
      })
    }
    return { materialized: due.length, candidates }
  }, PRICE_HISTORY_WRITE_TX_OPTIONS)
}

/**
 * Decide candidates, one product at a time under the product lock. Eligible drops of one
 * product at one instant are grouped: the lowest new price is announced (`pending`), the rest
 * are `grouped` for audit.
 */
export async function evaluatePriceDropCandidates(
  prisma: PrismaClient,
  options: { now?: Date; productLimit?: number; productIds?: readonly string[] } = {},
) {
  const now = options.now ?? new Date()
  const scope = options.productIds
    ? Prisma.sql`AND e."productId" = ANY(${[...options.productIds]}::text[])`
    : Prisma.empty
  const products = await prisma.$queryRaw<{ productId: string }[]>(Prisma.sql`
    SELECT DISTINCT e."productId" FROM price_drop_events e
    WHERE e.status = 'candidate' ${scope}
      AND NOT EXISTS (
        SELECT 1 FROM price_change_markers m
        WHERE m."processedAt" IS NULL AND (m."productId" = e."productId" OR m."sellerId" = e."sellerId")
      )
    LIMIT ${options.productLimit ?? 25}
  `)
  let pending = 0
  let ineligible = 0
  let grouped = 0
  for (const { productId } of products) {
    const counts = await prisma.$transaction(async (tx) => {
      await lockProductsForPriceHistory(tx, [productId])
      const candidates = await tx.priceDropEvent.findMany({
        where: { productId, status: 'candidate' },
        orderBy: [{ changeAt: 'asc' }, { createdAt: 'asc' }],
      })
      const eligible: Array<(typeof candidates)[number] & { windowMin: Decimal }> = []
      let rejected = 0
      for (const candidate of candidates) {
        const result = await evaluateEventAt(tx, candidate, candidate.changeAt, now)
        if (result.eligible) {
          eligible.push({ ...candidate, windowMin: result.windowMin })
          continue
        }
        rejected += 1
        await tx.priceDropEvent.update({
          where: { id: candidate.id },
          data: {
            status: 'ineligible',
            reason: result.reason,
            windowMinPrice: result.windowMin,
            evaluatedAt: now,
            completedAt: now,
          },
        })
      }
      const byInstant = new Map<number, typeof eligible>()
      for (const drop of eligible) {
        const list = byInstant.get(drop.changeAt.getTime()) ?? []
        list.push(drop)
        byInstant.set(drop.changeAt.getTime(), list)
      }
      let announced = 0
      let groupedHere = 0
      for (const drops of byInstant.values()) {
        const existingPrimary = await tx.priceDropEvent.findFirst({
          where: {
            productId,
            changeAt: drops[0]!.changeAt,
            status: { in: ['pending', 'dispatching', 'dispatched'] },
          },
          select: { id: true },
        })
        const primary = existingPrimary ? null : pickPrimaryDrop(drops.map((drop) => ({ ...drop, newPrice: new Decimal(drop.newPrice.toString()) })))
        const primaryId = existingPrimary?.id ?? primary!.id
        for (const drop of drops) {
          const isPrimary = !existingPrimary && drop.id === primary!.id
          await tx.priceDropEvent.update({
            where: { id: drop.id },
            data: {
              status: isPrimary ? 'pending' : 'grouped',
              windowMinPrice: drop.windowMin,
              evaluatedAt: now,
              ...(isPrimary ? {} : { primaryEventId: primaryId, completedAt: now }),
            },
          })
          if (isPrimary) announced += 1
          else groupedHere += 1
        }
      }
      return { announced, rejected, groupedHere }
    }, PRICE_HISTORY_WRITE_TX_OPTIONS)
    pending += counts.announced
    ineligible += counts.rejected
    grouped += counts.groupedHere
  }
  return { products: products.length, pending, ineligible, grouped }
}
