/**
 * Lowest-price e-mail dispatch (e-mail plan phase 6).
 *
 * One tick advances one `pending`/`dispatching` event inside one bounded transaction:
 *   1. an event older than 24 hours, or no longer eligible now, is cancelled with its reason;
 *   2. a `pending` event freezes its audience once: the product's favoriters with the customer
 *      role (not the seller's own account, not banned). Users without marketing consent are
 *      recorded as `skipped/no_consent`; everyone else waits as `awaiting_capacity`;
 *   3. waiting recipients are reserved (shared limits, per-user lock) and written to the outbox,
 *      at most as many as the bulk lane has room for. A recipient refused by a limit is
 *      `skipped` for good — never retried for this event;
 *   4. with nobody waiting, the event is `dispatched`.
 *
 * Mağaza takibi kitleye girmez (iş sahibi kararı, 2026-09-24): yalnız favorileyenler.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { resolveEmailImageUrl } from '../lib/email-line-items'
import { amountText } from '../lib/email-templates/shared'
import { getWebBaseUrl } from '../lib/platform-info'
import { ANNOUNCEMENT_BULK_INFLIGHT_CAP } from './announcement-dispatch.service'
import { reserveCampaignEmail } from './campaign-email-reservation'
import { recordNotifications } from './notification-outbox.service'
import { evaluateEventNow } from './price-drop-evaluation.service'
import { priceDropFingerprint } from './price-history.service'
import { PRICE_DROP_EVENT_TTL_MS } from '../domain/price-drop-eligibility'
import type { NotificationDispatchJobData } from '../jobs/notification-dispatch.job'

type Tx = Prisma.TransactionClient

const DISPATCH_LOCK_NAME = 'hanuja:price-drop-dispatch'
export const PRICE_DROP_TITLE = 'Favorilediğiniz ürün son 15 günün en düşük fiyatında'

export type PriceDropDispatchResult = {
  skipped?: 'locked' | 'idle' | 'capacity'
  eventId?: string
  cancelled?: string
  frozen?: number
  reserved: number
  skippedRecipients: number
  completed?: boolean
}

export function priceDropEventKey(eventId: string, userId: string) {
  return `price-drop:${eventId}:user:${userId}`
}

export function priceDropProductUrl(slug: string, variantId: string | null) {
  const url = `${getWebBaseUrl()}/urun/${encodeURIComponent(slug)}`
  return variantId ? `${url}?varyant=${encodeURIComponent(variantId)}` : url
}

function unsubscribeUrl(token: string) {
  return `${getWebBaseUrl()}/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`
}

async function cancelEvent(tx: Tx, eventId: string, reason: string, now: Date) {
  await tx.priceDropEvent.update({
    where: { id: eventId },
    data: { status: 'cancelled', reason, completedAt: now },
  })
  await tx.priceDropRecipient.updateMany({
    where: { eventId, status: 'awaiting_capacity' },
    data: { status: 'skipped', skipReason: reason },
  })
  await tx.campaignEmailDispatch.updateMany({
    where: { discountFingerprint: priceDropFingerprint(eventId), status: 'reserved' },
    data: { status: 'released', releaseReason: reason },
  })
}

async function freezeAudience(tx: Tx, event: { id: string; productId: string }, sellerUserId: string, now: Date) {
  return tx.$executeRaw(Prisma.sql`
    INSERT INTO price_drop_recipients (id, "eventId", "userId", status, "skipReason", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text, ${event.id}, f."userId",
      CASE WHEN mc."emailConsentAt" IS NOT NULL AND mc."emailRevokedAt" IS NULL
        THEN 'awaiting_capacity'::"PriceDropRecipientStatus" ELSE 'skipped'::"PriceDropRecipientStatus" END,
      CASE WHEN mc."emailConsentAt" IS NOT NULL AND mc."emailRevokedAt" IS NULL THEN NULL ELSE 'no_consent' END,
      ${now}, ${now}
    FROM favorite_products f
    JOIN users u ON u.id = f."userId" AND u.role = 'customer' AND u.banned = false
    LEFT JOIN marketing_consents mc ON mc."userId" = f."userId"
    WHERE f."productId" = ${event.productId} AND f."userId" <> ${sellerUserId}
    ON CONFLICT ("eventId", "userId") DO NOTHING
  `)
}

export async function advancePriceDropDispatch(
  prisma: PrismaClient,
  options: { now?: Date; cap?: number } = {},
): Promise<PriceDropDispatchResult> {
  const cap = options.cap ?? ANNOUNCEMENT_BULK_INFLIGHT_CAP
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`)
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5s'`)
      const now = options.now ?? new Date()
      const [lock] = await tx.$queryRaw<{ locked: boolean }[]>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${DISPATCH_LOCK_NAME})) AS locked`,
      )
      if (!lock?.locked) return { skipped: 'locked', reserved: 0, skippedRecipients: 0 }

      const [picked] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT e.id FROM price_drop_events e
        WHERE e.status IN ('pending', 'dispatching')
          AND NOT EXISTS (
            SELECT 1 FROM price_change_markers m
            WHERE m."processedAt" IS NULL AND (m."productId" = e."productId" OR m."sellerId" = e."sellerId")
          )
        ORDER BY e."createdAt", e.id
        LIMIT 1
        FOR UPDATE OF e SKIP LOCKED
      `)
      if (!picked) return { skipped: 'idle', reserved: 0, skippedRecipients: 0 }
      const event = await tx.priceDropEvent.findUniqueOrThrow({ where: { id: picked.id } })

      if (event.changeAt.getTime() < now.getTime() - PRICE_DROP_EVENT_TTL_MS) {
        await cancelEvent(tx, event.id, 'expired', now)
        return { eventId: event.id, cancelled: 'expired', reserved: 0, skippedRecipients: 0 }
      }
      const current = await evaluateEventNow(tx, event, now)
      if (!current.eligible) {
        await cancelEvent(tx, event.id, current.reason, now)
        return { eventId: event.id, cancelled: current.reason, reserved: 0, skippedRecipients: 0 }
      }

      const product = await tx.product.findUniqueOrThrow({
        where: { id: event.productId },
        select: {
          name: true,
          slug: true,
          seller: { select: { userId: true, displayName: true } },
          images: { select: { url: true, isPrimary: true, sortOrder: true } },
          variants: { where: event.variantId ? { id: event.variantId } : { id: '__none__' }, select: { name: true } },
        },
      })

      let frozen: number | undefined
      if (event.status === 'pending') {
        frozen = await freezeAudience(tx, event, product.seller.userId, now)
        await tx.priceDropEvent.update({
          where: { id: event.id },
          data: { status: 'dispatching', audienceFrozenAt: now },
        })
      }

      const inFlight = await tx.notificationOutbox.count({
        where: { lane: 'bulk', status: { in: ['pending', 'queued'] } },
      })
      const room = cap - inFlight
      if (room <= 0) {
        return { skipped: 'capacity', eventId: event.id, ...(frozen !== undefined ? { frozen } : {}), reserved: 0, skippedRecipients: 0 }
      }

      const waiting = await tx.$queryRaw<
        Array<{ id: string; userId: string; email: string; name: string | null; optOutToken: string | null }>
      >(Prisma.sql`
        SELECT r.id, r."userId", u.email, u.name, mc."optOutToken"
        FROM price_drop_recipients r
        JOIN users u ON u.id = r."userId"
        LEFT JOIN marketing_consents mc ON mc."userId" = r."userId"
        WHERE r."eventId" = ${event.id} AND r.status = 'awaiting_capacity'
        ORDER BY r.id
        LIMIT ${room}
        FOR UPDATE OF r SKIP LOCKED
      `)

      const variantName = product.variants[0]?.name ?? null
      const productUrl = priceDropProductUrl(product.slug, event.variantId)
      const imageUrl = resolveEmailImageUrl(product.images)
      const priceText = amountText(Number(event.newPrice))
      const payloads: NotificationDispatchJobData[] = []
      let reserved = 0
      let skippedRecipients = 0
      for (const recipient of waiting) {
        if (!recipient.optOutToken) {
          skippedRecipients += 1
          await tx.priceDropRecipient.update({
            where: { id: recipient.id },
            data: { status: 'skipped', skipReason: 'no_consent' },
          })
          continue
        }
        const eventKey = priceDropEventKey(event.id, recipient.userId)
        const reservation = await reserveCampaignEmail(tx, {
          userId: recipient.userId,
          productId: event.productId,
          source: 'price_drop',
          fingerprint: priceDropFingerprint(event.id),
          eventKey,
          now,
        })
        if (!reservation.ok) {
          skippedRecipients += 1
          await tx.priceDropRecipient.update({
            where: { id: recipient.id },
            data: { status: 'skipped', skipReason: reservation.reason },
          })
          continue
        }
        reserved += 1
        await tx.priceDropRecipient.update({
          where: { id: recipient.id },
          data: { status: 'reserved', reservationId: reservation.id },
        })
        payloads.push({
          userId: recipient.userId,
          type: 'product_price_drop',
          eventKey,
          title: PRICE_DROP_TITLE,
          body: `${product.name} şimdi ${priceText}.`,
          emailTo: recipient.email,
          data: {
            priceDropEventId: event.id,
            customerName: recipient.name ?? 'Değerli Müşterimiz',
            productName: product.name,
            ...(variantName ? { variantName } : {}),
            sellerName: product.seller.displayName,
            productUrl,
            ...(imageUrl ? { imageUrl } : {}),
            priceText,
            unsubscribeUrl: unsubscribeUrl(recipient.optOutToken),
          },
        })
      }
      await recordNotifications(tx, payloads)

      const stillWaiting = await tx.priceDropRecipient.count({
        where: { eventId: event.id, status: 'awaiting_capacity' },
      })
      let completed = false
      if (stillWaiting === 0) {
        const total = await tx.priceDropRecipient.count({ where: { eventId: event.id, status: 'reserved' } })
        await tx.priceDropEvent.update({
          where: { id: event.id },
          data: { status: 'dispatched', recipientCount: total, completedAt: now },
        })
        completed = true
      }
      return {
        eventId: event.id,
        ...(frozen !== undefined ? { frozen } : {}),
        reserved,
        skippedRecipients,
        completed,
      }
    },
    { timeout: 20_000, maxWait: 2_000 },
  )
}
