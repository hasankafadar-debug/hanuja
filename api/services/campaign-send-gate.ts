/**
 * Send gate for campaign e-mails (e-mail plan phase 6). Runs in notification-dispatch before
 * the in-app and e-mail legs.
 *
 * - The old favorite and store-follow discount notifications are closed: anything of those
 *   types still queued is skipped with LEGACY_CAMPAIGN_DISABLED.
 * - Cart and lowest-price notifications need their reservation. Under the per-user lock the
 *   shared limits and the cart-vs-price-drop priority are checked again, then the reservation
 *   moves to `sending`.
 * - A lowest-price notification first processes the product's pending change markers inline
 *   (an unexplained change resets trust and releases the reservation), then re-runs the full
 *   eligibility for "now": sellable, trusted for 15 days, unchanged price and still not above
 *   the minimum of the last 15 days. A price that went down and came back is caught here.
 */
import type { NotificationType, PrismaClient } from '@prisma/client'
import { EMAIL_POLICIES } from '../lib/notification-policy'
import { getMarketingChannelStatus, releaseBlockedMarketingReservation } from './marketing-channel.service'
import { checkCampaignLimits, lockCampaignUser } from './campaign-email-reservation'
import { hasPendingMarkers, processPriceChangeMarkers } from './price-change-reconcile.service'
import { evaluateEventNow } from './price-drop-evaluation.service'

export const LEGACY_CAMPAIGN_TYPES: ReadonlySet<string> = new Set([
  'product_discount_favorited',
  'store_discount_followed_seller',
])
export const RESERVED_CAMPAIGN_TYPES: ReadonlySet<string> = new Set(['product_discount_in_cart', 'product_price_drop'])

export type CampaignGateResult = { proceed: true } | { proceed: false; reason: string }

export async function runCampaignSendGate(
  prisma: PrismaClient,
  input: { type: NotificationType; eventKey: string; userId: string; now?: Date },
): Promise<CampaignGateResult> {
  if (LEGACY_CAMPAIGN_TYPES.has(input.type)) return { proceed: false, reason: 'LEGACY_CAMPAIGN_DISABLED' }
  if (EMAIL_POLICIES[input.type]?.category === 'kampanya') {
    const channel = await getMarketingChannelStatus(prisma, 'email')
    if (!channel.canSend) {
      await releaseBlockedMarketingReservation(prisma, input.eventKey, channel.reason)
      return { proceed: false, reason: channel.reason }
    }
  }
  if (!RESERVED_CAMPAIGN_TYPES.has(input.type)) return { proceed: true }

  const reservation = await prisma.campaignEmailDispatch.findUnique({
    where: { eventKey: input.eventKey },
    select: { id: true, status: true, releaseReason: true, discountFingerprint: true, productId: true },
  })
  if (!reservation) return { proceed: false, reason: 'CAMPAIGN_RESERVATION_MISSING' }
  // Already past the gate: the delivery's own idempotency (sent / uncertain / lease) decides.
  if (reservation.status === 'sending' || reservation.status === 'sent' || reservation.status === 'uncertain') {
    return { proceed: true }
  }
  if (reservation.status === 'released') {
    return { proceed: false, reason: `CAMPAIGN_RELEASED:${reservation.releaseReason ?? 'unknown'}` }
  }

  const isPriceDrop = input.type === 'product_price_drop'
  const eventId = isPriceDrop ? reservation.discountFingerprint.replace(/^price-drop:/, '') : null
  if (isPriceDrop && eventId) {
    const event = await prisma.priceDropEvent.findUnique({
      where: { id: eventId },
      select: { productId: true, sellerId: true },
    })
    if (event) {
      // Decide only once every change of this product and seller is accounted for.
      for (let round = 0; round < 20; round += 1) {
        const processed = await processPriceChangeMarkers(prisma, {
          scope: { productIds: [event.productId], sellerIds: [event.sellerId] },
          ...(input.now ? { now: input.now } : {}),
        })
        if (processed.explained + processed.reset + processed.ignored === 0) break
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const now = input.now ?? new Date()
    await lockCampaignUser(tx, input.userId)
    const fresh = await tx.campaignEmailDispatch.findUnique({
      where: { id: reservation.id },
      select: { status: true, releaseReason: true, source: true, productId: true },
    })
    if (!fresh) return { proceed: false as const, reason: 'CAMPAIGN_RESERVATION_MISSING' }
    if (fresh.status === 'released') {
      return { proceed: false as const, reason: `CAMPAIGN_RELEASED:${fresh.releaseReason ?? 'unknown'}` }
    }
    if (fresh.status !== 'reserved') return { proceed: true as const }

    const release = async (reason: string) => {
      await tx.campaignEmailDispatch.update({
        where: { id: reservation.id },
        data: { status: 'released', releaseReason: reason },
      })
      return { proceed: false as const, reason: `CAMPAIGN_RELEASED:${reason}` }
    }

    if (isPriceDrop && eventId) {
      const event = await tx.priceDropEvent.findUnique({
        where: { id: eventId },
        select: { historySeq: true, productId: true, sellerId: true, priceKey: true, status: true, reason: true },
      })
      if (!event) return release('event_missing')
      // A change that landed after the inline processing above: do not decide now. The job fails
      // and BullMQ retries it; the next attempt processes the marker first.
      if (await hasPendingMarkers(tx, event.productId, event.sellerId)) {
        throw new Error('PRICE_HISTORY_MARKERS_PENDING')
      }
      if (event.status === 'cancelled') return release(event.reason ?? 'event_cancelled')
      if (!['pending', 'dispatching', 'dispatched'].includes(event.status)) return release(`event_${event.status}`)
      const evaluation = await evaluateEventNow(tx, event, now)
      if (!evaluation.eligible) return release(evaluation.reason)
    }

    const limit = await checkCampaignLimits(tx, {
      userId: input.userId,
      productId: fresh.productId,
      source: fresh.source,
      now,
      excludeId: reservation.id,
    })
    if (limit) return release(limit)

    const consent = await tx.marketingConsent.findUnique({
      where: { userId: input.userId },
      select: { emailConsentAt: true, emailRevokedAt: true },
    })
    if (!consent?.emailConsentAt || consent.emailRevokedAt) return release('no_consent')

    await tx.campaignEmailDispatch.update({
      where: { id: reservation.id },
      data: { status: 'sending', sendingAt: now },
    })
    return { proceed: true as const }
  })
}
