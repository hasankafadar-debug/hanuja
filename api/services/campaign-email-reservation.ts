/**
 * Campaign e-mail reservations and the shared limits (e-mail plan phase 6).
 *
 * The cart discount e-mail and the lowest-price e-mail share two limits (transactional e-mail
 * never counts):
 *   - one e-mail per user and product in 7 days,
 *   - at most 3 e-mails per user in any rolling 24 hours.
 *
 * A reservation is written when the e-mail is queued (`reserved`). Only `sending`, `sent` and
 * `uncertain` count toward the limits, measured on the real send time. The send gate in
 * notification-dispatch re-checks the limits under the same per-user lock right before sending;
 * a reservation that is never sent is `released` with a reason and consumes nothing. An SMTP
 * outcome that is unknown (`uncertain`) counts, because the e-mail may have gone out.
 *
 * Priority: when a lowest-price reservation exists for the same user and product, the cart one
 * gives way (`superseded_by_price_drop`) wherever it is checked.
 */
import { Prisma, type CampaignDispatchSource, type PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient

export const CAMPAIGN_EMAIL_COOLDOWN_DAYS = 7
export const CAMPAIGN_EMAIL_DAILY_CAP = 3
const DAY_MS = 24 * 60 * 60 * 1000
/** A queued reservation not sent within this time is released. */
export const CAMPAIGN_RESERVATION_TTL_MS = DAY_MS

const COUNTED_STATUSES = ['sending', 'sent', 'uncertain'] as const
const USER_LOCK_PREFIX = 'campaign-email-user:'

export type CampaignSkipReason =
  | 'already'
  | 'cooldown'
  | 'daily_cap'
  | 'pending_reservation'
  | 'superseded_by_price_drop'

export type ReserveResult = { ok: true; id: string } | { ok: false; reason: CampaignSkipReason }

export async function lockCampaignUser(tx: Tx, userId: string) {
  await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${USER_LOCK_PREFIX} || ${userId}))`)
}

/** Rows that count toward the limits whose send time is at or after `since`. */
function countedSince(since: Date): Prisma.CampaignEmailDispatchWhereInput {
  return {
    status: { in: [...COUNTED_STATUSES] },
    OR: [{ sentAt: { gte: since } }, { sentAt: null, sendingAt: { gte: since } }],
  }
}

export interface LimitCheckInput {
  userId: string
  productId: string | null
  source: CampaignDispatchSource
  now: Date
  /** The reservation being checked (excluded from its own counts). */
  excludeId?: string
}

/** Cooldown, daily cap and cart-vs-price-drop priority. The caller holds the user lock. */
export async function checkCampaignLimits(tx: Tx, input: LimitCheckInput): Promise<CampaignSkipReason | null> {
  const { userId, productId, now } = input
  const notSelf = input.excludeId ? { id: { not: input.excludeId } } : {}

  if (productId) {
    const recent = await tx.campaignEmailDispatch.count({
      where: {
        userId,
        productId,
        ...notSelf,
        ...countedSince(new Date(now.getTime() - CAMPAIGN_EMAIL_COOLDOWN_DAYS * DAY_MS)),
      },
    })
    if (recent > 0) return 'cooldown'
  }

  const daily = await tx.campaignEmailDispatch.count({
    where: { userId, ...notSelf, ...countedSince(new Date(now.getTime() - DAY_MS)) },
  })
  if (daily >= CAMPAIGN_EMAIL_DAILY_CAP) return 'daily_cap'

  if (productId && input.source !== 'price_drop') {
    const priceDrop = await tx.campaignEmailDispatch.count({
      where: {
        userId,
        productId,
        source: 'price_drop',
        status: { in: ['reserved', 'sending', 'sent'] },
        createdAt: { gte: new Date(now.getTime() - CAMPAIGN_EMAIL_COOLDOWN_DAYS * DAY_MS) },
      },
    })
    if (priceDrop > 0) return 'superseded_by_price_drop'
  }
  return null
}

export interface ReserveInput {
  userId: string
  productId: string | null
  source: CampaignDispatchSource
  fingerprint: string
  eventKey: string
  discountRuleId?: string | null
  now: Date
}

/**
 * Reserve one campaign e-mail. Takes the per-user lock, so the limits cannot be passed by a
 * concurrent producer. A lowest-price reservation releases a queued cart reservation for the
 * same product.
 */
export async function reserveCampaignEmail(tx: Tx, input: ReserveInput): Promise<ReserveResult> {
  await lockCampaignUser(tx, input.userId)

  const existing = await tx.campaignEmailDispatch.findFirst({
    where: { userId: input.userId, discountFingerprint: input.fingerprint, source: input.source },
    select: { id: true },
  })
  if (existing) return { ok: false, reason: 'already' }

  const limit = await checkCampaignLimits(tx, input)
  if (limit) return { ok: false, reason: limit }

  const pendingSince = new Date(input.now.getTime() - CAMPAIGN_RESERVATION_TTL_MS)
  const queued = input.productId ? await tx.campaignEmailDispatch.findMany({
    where: { userId: input.userId, productId: input.productId, status: 'reserved', createdAt: { gte: pendingSince } },
    select: { id: true, source: true },
  }) : []
  const blocking = queued.filter((row) => input.source !== 'price_drop' || row.source === 'price_drop')
  if (blocking.length) return { ok: false, reason: 'pending_reservation' }

  if (input.source === 'price_drop') {
    const cartIds = queued.filter((row) => row.source !== 'price_drop').map((row) => row.id)
    if (cartIds.length) {
      await tx.campaignEmailDispatch.updateMany({
        where: { id: { in: cartIds }, status: 'reserved' },
        data: { status: 'released', releaseReason: 'superseded_by_price_drop' },
      })
    }
  }

  const created = await tx.campaignEmailDispatch.create({
    data: {
      userId: input.userId,
      productId: input.productId,
      discountRuleId: input.discountRuleId ?? null,
      discountFingerprint: input.fingerprint,
      source: input.source,
      eventKey: input.eventKey,
      status: 'reserved',
    },
    select: { id: true },
  })
  return { ok: true, id: created.id }
}

/** Moves a reservation after the send attempt. Only a reservation that is `sending` moves. */
export async function markCampaignReservation(
  prisma: PrismaClient | Tx,
  eventKey: string,
  outcome: 'sent' | 'uncertain' | 'failed',
  now = new Date(),
) {
  if (outcome === 'sent') {
    return prisma.campaignEmailDispatch.updateMany({
      where: { eventKey, status: { in: ['sending', 'uncertain'] } },
      data: { status: 'sent', sentAt: now, emailSentAt: now },
    })
  }
  if (outcome === 'uncertain') {
    return prisma.campaignEmailDispatch.updateMany({
      where: { eventKey, status: 'sending' },
      data: { status: 'uncertain' },
    })
  }
  // A definite failure did not send: the next attempt goes through the gate again.
  return prisma.campaignEmailDispatch.updateMany({
    where: { eventKey, status: 'sending' },
    data: { status: 'reserved', sendingAt: null },
  })
}

/** Queued reservations that never reached the gate in time are released. */
export async function expireStaleCampaignReservations(prisma: PrismaClient, now = new Date()) {
  const result = await prisma.campaignEmailDispatch.updateMany({
    where: { status: 'reserved', createdAt: { lt: new Date(now.getTime() - CAMPAIGN_RESERVATION_TTL_MS) } },
    data: { status: 'released', releaseReason: 'expired' },
  })
  return result.count
}
