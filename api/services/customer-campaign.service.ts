/** Admin-authored customer campaign drafts. Delivery is deliberately gated by IYS readiness. */
import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import { istanbulDayStart } from '../domain/announcement-audience'
import {
  CUSTOMER_CAMPAIGN_BODY_MAX, CUSTOMER_CAMPAIGN_TITLE_MAX,
  DEFAULT_CUSTOMER_CAMPAIGN_AUDIENCE, customerCampaignAudienceSchema,
  normalizeCampaignCtaUrl, type CustomerCampaignAudience,
  type CustomerCampaignDraftInput,
} from '../domain/customer-campaign'
import { announcementDisplayMedia } from './announcement-content'
import { getWebBaseUrl } from '../lib/platform-info'
import { assertMarketingChannelOpen, getMarketingChannelStatus } from './marketing-channel.service'
import { checkCampaignLimits, lockCampaignUser } from './campaign-email-reservation'
import { recordNotification } from './notification-outbox.service'

type Db = PrismaClient | Prisma.TransactionClient
const PAGE_SIZE = 20
const RECIPIENT_PAGE_SIZE = 50
const SWEEP_BATCH_SIZE = 50
const SWEEP_INFLIGHT_CAP = 100
const mediaSelect = { id: true, url: true, kind: true, originalName: true } as const

function parseAudience(value: unknown): CustomerCampaignAudience {
  const parsed = customerCampaignAudienceSchema.safeParse(value)
  if (!parsed.success) throw new ValidationError('Kayıtlı alıcı seçimi geçersiz. Alıcıları yeniden seçin.')
  return parsed.data
}

function audienceWhere(audience: CustomerCampaignAudience): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ role: 'customer', banned: false }]
  if (audience.mode === 'manual') and.push({ id: { in: audience.manualUserIds } })
  if (audience.mode === 'filter') {
    if (audience.filters.registeredFrom)
      and.push({ createdAt: { gte: istanbulDayStart(audience.filters.registeredFrom) } })
    if (audience.filters.registeredTo) {
      const next = new Date(istanbulDayStart(audience.filters.registeredTo).getTime() + 86_400_000)
      and.push({ createdAt: { lt: next } })
    }
  }
  if (audience.excludedUserIds.length) and.push({ id: { notIn: audience.excludedUserIds } })
  return { AND: and }
}

function audienceHash(ids: readonly string[]) {
  return createHash('sha256').update([...ids].sort().join('\n')).digest('hex')
}

export function customerCampaignEventKey(campaignId: string, userId: string) {
  return `customer-campaign:${campaignId}:user:${userId}`
}

function assertContent(title: string, body: string, ctaLabel: string | null, ctaUrl: string | null, forSubmit: boolean) {
  if (title.trim().length > CUSTOMER_CAMPAIGN_TITLE_MAX) throw new ValidationError('Başlık çok uzun.')
  if (body.trim().length > CUSTOMER_CAMPAIGN_BODY_MAX) throw new ValidationError('Metin çok uzun.')
  if (!!ctaLabel?.trim() !== !!ctaUrl?.trim())
    throw new ValidationError('Bağlantı metni ve adresi birlikte girilmeli.')
  if (ctaUrl && !normalizeCampaignCtaUrl(ctaUrl))
    throw new ValidationError('Bağlantı yalnız güvenli Hanuja mağaza adresine gidebilir.')
  if (forSubmit && (title.trim().length < 3 || !body.trim()))
    throw new ValidationError('Başlık ve mesaj metni zorunludur.')
}

async function assertMedia(db: Db, mediaAssetId: string | null, posterAssetId: string | null) {
  if (!mediaAssetId) {
    if (posterAssetId) throw new ValidationError('Kapak görseli yalnız video ile kullanılabilir.')
    return
  }
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: posterAssetId ? [mediaAssetId, posterAssetId] : [mediaAssetId] } },
    select: { id: true, status: true, folder: true, kind: true },
  })
  const media = assets.find((item) => item.id === mediaAssetId)
  if (!media || media.status !== 'ready' || media.folder !== 'announcements' ||
    !['image', 'video'].includes(media.kind))
    throw new ValidationError('Medya hazır değil veya kullanılamıyor.')
  if (media.kind === 'video' && !posterAssetId)
    throw new ValidationError('Video için kapak görseli zorunludur.')
  if (media.kind === 'image' && posterAssetId)
    throw new ValidationError('Kapak görseli yalnız video ile kullanılabilir.')
  if (posterAssetId) {
    const poster = assets.find((item) => item.id === posterAssetId)
    if (!poster || poster.status !== 'ready' || poster.folder !== 'announcements' || poster.kind !== 'image')
      throw new ValidationError('Kapak görseli hazır değil veya kullanılamıyor.')
  }
}

async function eligibility(db: Db, ids: readonly string[], channel: 'email' | 'sms') {
  if (!ids.length) return { selected: 0, missingConsent: 0, iysUnverified: 0, dailyLimit: 0, eligible: 0 }
  const rows = await db.$queryRaw<{ missingConsent: number; consented: number; dailyLimit: number }[]>(Prisma.sql`
    WITH selected AS (
      SELECT u.id, u.email
      FROM users u
      WHERE u.id = ANY(${ids as string[]}::text[])
    ), checked AS (
      SELECT s.id,
        EXISTS (SELECT 1 FROM marketing_consent_addresses a
          WHERE a."userId" = s.id AND a.brand = 'hanuja' AND a.channel = ${channel}
            AND a.status IN ('granted', 'legacy_unverified') AND a."revokedAt" IS NULL
            AND (${channel} <> 'email' OR a.address = lower(trim(s.email)))) AS consented,
        (SELECT count(*) FROM campaign_email_dispatches d
         WHERE d."userId" = s.id AND d.status IN ('sending', 'sent', 'uncertain')
           AND COALESCE(d."sentAt", d."sendingAt") >= now() - interval '24 hours') AS daily
      FROM selected s
    )
    SELECT count(*) FILTER (WHERE NOT consented)::int AS "missingConsent",
           count(*) FILTER (WHERE consented)::int AS consented,
           count(*) FILTER (WHERE consented AND daily >= 3)::int AS "dailyLimit"
    FROM checked
  `)
  const result = rows[0]
  const selected = ids.length
  const missingConsent = Number(result?.missingConsent ?? 0)
  const consented = Number(result?.consented ?? 0)
  const dailyLimit = channel === 'email' ? Number(result?.dailyLimit ?? 0) : 0
  // IYS has no production read integration; consent alone cannot authorize delivery.
  return { selected, missingConsent, iysUnverified: consented, dailyLimit, eligible: 0 }
}

export function createCustomerCampaignService({ prisma }: { prisma: PrismaClient }) {
  async function conflict(id: string): Promise<never> {
    const row = await prisma.customerCampaign.findUnique({ where: { id }, select: { status: true } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    if (row.status !== 'draft') throw new ConflictError('Gönderime alınan kampanya değiştirilemez. Yeni kopya oluşturun.')
    throw new ConflictError('Taslak başka bir yerde değiştirildi. Sayfayı yenileyin.')
  }

  async function createDraft(actorId: string, channel: 'email' | 'sms') {
    return prisma.$transaction(async (tx) => {
    const row = await tx.customerCampaign.create({
      data: { channel, title: '', body: '', audience: DEFAULT_CUSTOMER_CAMPAIGN_AUDIENCE as Prisma.InputJsonValue, createdByAdminId: actorId },
      select: { id: true },
    })
    await tx.adminAuditLog.create({ data: { actorId, actionType: 'customer_campaign_created', targetType: 'customer_campaign', targetId: row.id, newData: { channel } } })
    return row
    })
  }

  async function updateDraft(actorId: string, id: string, input: CustomerCampaignDraftInput) {
    assertContent(input.title, input.body, input.ctaLabel, input.ctaUrl, false)
    await assertMedia(prisma, input.mediaAssetId, input.posterAssetId)
    const audience = customerCampaignAudienceSchema.parse(input.audience)
    const previous = await prisma.customerCampaign.findUnique({ where: { id }, select: { title: true, version: true, status: true } })
    if (!previous) throw new NotFoundError('Müşteri kampanyası')
    return prisma.$transaction(async (tx) => {
    const result = await tx.customerCampaign.updateMany({
      where: { id, status: 'draft', version: input.version },
      data: {
        title: input.title.trim(), body: input.body.trim(), ctaLabel: input.ctaLabel?.trim() || null,
        ctaUrl: normalizeCampaignCtaUrl(input.ctaUrl), mediaAssetId: input.mediaAssetId,
        posterAssetId: input.posterAssetId, audience: audience as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    })
    if (!result.count) await conflict(id)
    await tx.adminAuditLog.create({ data: { actorId, actionType: 'customer_campaign_updated', targetType: 'customer_campaign', targetId: id, previousData: { version: previous.version, title: previous.title }, newData: { version: input.version + 1, title: input.title.trim() } } })
    return { version: input.version + 1 }
    })
  }

  async function deleteDraft(actorId: string, id: string, version: number) {
    return prisma.$transaction(async (tx) => {
    const result = await tx.customerCampaign.deleteMany({ where: { id, status: 'draft', version } })
    if (!result.count) await conflict(id)
    await tx.adminAuditLog.create({ data: { actorId, actionType: 'customer_campaign_deleted', targetType: 'customer_campaign', targetId: id, newData: { version } } })
    return { deleted: true }
    })
  }

  async function copyCampaign(actorId: string, id: string, version: number) {
    const original = await prisma.customerCampaign.findUnique({ where: { id } })
    if (!original) throw new NotFoundError('Müşteri kampanyası')
    if (original.version !== version) throw new ConflictError('Kampanya değişti. Sayfayı yenileyin.')
    return prisma.$transaction(async (tx) => {
    const copy = await tx.customerCampaign.create({
      data: {
        channel: original.channel, title: original.title, body: original.body,
        ctaLabel: original.ctaLabel, ctaUrl: original.ctaUrl,
        mediaAssetId: original.mediaAssetId, posterAssetId: original.posterAssetId,
        audience: original.audience as Prisma.InputJsonValue, createdByAdminId: actorId,
      }, select: { id: true },
    })
    await tx.adminAuditLog.create({ data: { actorId, actionType: 'customer_campaign_copied', targetType: 'customer_campaign', targetId: copy.id, newData: { sourceId: id } } })
    return copy
    })
  }

  async function listForAdmin(channel: 'email' | 'sms', page = 1) {
    const safePage = Math.max(1, Math.floor(page))
    const [rows, total] = await Promise.all([
      prisma.customerCampaign.findMany({ where: { channel }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (safePage - 1) * PAGE_SIZE, take: PAGE_SIZE, select: { id: true, title: true, status: true, version: true, recipientCount: true, submittedAt: true, createdAt: true } }),
      prisma.customerCampaign.count({ where: { channel } }),
    ])
    return { rows, total, page: safePage, pageSize: PAGE_SIZE }
  }

  async function getForAdmin(id: string) {
    const row = await prisma.customerCampaign.findUnique({ where: { id }, include: { mediaAsset: { select: mediaSelect }, posterAsset: { select: mediaSelect } } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    const parsed = customerCampaignAudienceSchema.safeParse(row.audience)
    return {
      ...row,
      audience: parsed.success ? parsed.data : DEFAULT_CUSTOMER_CAMPAIGN_AUDIENCE,
      audienceInvalid: !parsed.success,
      displayMedia: announcementDisplayMedia(row.mediaAsset, row.posterAsset),
      media: row.mediaAsset && { id: row.mediaAsset.id, kind: row.mediaAsset.kind, originalName: row.mediaAsset.originalName, url: row.mediaAsset.url },
      poster: row.posterAsset && { id: row.posterAsset.id, kind: row.posterAsset.kind, originalName: row.posterAsset.originalName, url: row.posterAsset.url },
    }
  }

  async function searchCustomers(query: string) {
    const q = query.trim()
    if (q.length < 2) return []
    return prisma.user.findMany({ where: { role: 'customer', banned: false, OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] }, select: { id: true, email: true, name: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 })
  }

  async function previewRecipients(id: string, page = 1) {
    const row = await prisma.customerCampaign.findUnique({ where: { id }, select: { status: true, version: true, audience: true, channel: true } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    if (row.status !== 'draft') throw new ConflictError('Alıcı listesi donduruldu.')
    const audience = parseAudience(row.audience)
    const users = await prisma.user.findMany({ where: audienceWhere(audience), select: { id: true, name: true, email: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    const ids = users.map((user) => user.id)
    const safePage = Math.max(1, Math.floor(page))
    const channelStatus = await getMarketingChannelStatus(prisma, row.channel)
    return {
      version: row.version, audienceHash: audienceHash(ids), count: ids.length,
      page: safePage, pageSize: RECIPIENT_PAGE_SIZE,
      rows: users.slice((safePage - 1) * RECIPIENT_PAGE_SIZE, safePage * RECIPIENT_PAGE_SIZE),
      excludedCount: audience.excludedUserIds.length,
      eligibility: await eligibility(prisma, ids, row.channel), channelStatus,
    }
  }

  async function submit(actorId: string, id: string, input: { version: number; audienceHash: string }) {
    const row = await prisma.customerCampaign.findUnique({ where: { id }, select: { channel: true } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    // Always check immediately before entering the write transaction; current v1 IYS readiness is closed.
    await assertMarketingChannelOpen(prisma, row.channel)
    if (row.channel === 'sms') throw new ValidationError('SMS kampanyaları yalnız taslak olarak saklanabilir.')
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; version: number }[]>(Prisma.sql`
        SELECT status::text AS status, version FROM customer_campaigns WHERE id = ${id} FOR UPDATE
      `)
      if (!locked[0]) throw new NotFoundError('Müşteri kampanyası')
      if (locked[0].status !== 'draft') throw new ConflictError('Kampanya zaten gönderime alındı.')
      if (Number(locked[0].version) !== input.version) throw new ConflictError('Taslak değişti. Önizlemeyi yenileyin.')
      await assertMarketingChannelOpen(tx, 'email')
      const draft = await tx.customerCampaign.findUniqueOrThrow({
        where: { id }, select: { title: true, body: true, ctaLabel: true, ctaUrl: true, mediaAssetId: true, posterAssetId: true, audience: true, mediaAsset: { select: { url: true, kind: true } }, posterAsset: { select: { url: true, kind: true } } },
      })
      assertContent(draft.title, draft.body, draft.ctaLabel, draft.ctaUrl, true)
      await assertMedia(tx, draft.mediaAssetId, draft.posterAssetId)
      const audience = parseAudience(draft.audience)
      const users = await tx.user.findMany({ where: audienceWhere(audience), select: { id: true, email: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      if (!users.length) throw new ValidationError('Alıcı listesi boş.')
      const hash = audienceHash(users.map((user) => user.id))
      if (hash !== input.audienceHash) throw new ConflictError('Alıcı listesi değişti. Önizlemeyi yenileyin.')
      const now = new Date()
      for (let offset = 0; offset < users.length; offset += 1000) {
        await tx.customerCampaignRecipient.createMany({
          data: users.slice(offset, offset + 1000).map((user) => ({ campaignId: id, userId: user.id, email: user.email, eventKey: customerCampaignEventKey(id, user.id), submittedAt: now })),
        })
      }
      const content = {
        title: draft.title.trim(), body: draft.body.trim(), ctaLabel: draft.ctaLabel?.trim() || null,
        ctaUrl: normalizeCampaignCtaUrl(draft.ctaUrl), mediaAssetId: draft.mediaAssetId,
        posterAssetId: draft.posterAssetId, mediaUrl: draft.mediaAsset?.url ?? null,
        mediaKind: draft.mediaAsset?.kind ?? null, posterUrl: draft.posterAsset?.url ?? null,
      }
      await tx.customerCampaign.update({ where: { id }, data: {
        status: 'submitted', title: content.title, body: content.body, submittedContent: content,
        audienceHash: hash, recipientCount: users.length, submittedAt: now,
        submittedByAdminId: actorId, version: { increment: 1 },
      } })
      await tx.adminAuditLog.create({ data: { actorId, actionType: 'customer_campaign_submitted', targetType: 'customer_campaign', targetId: id, newData: { recipientCount: users.length, audienceHash: hash, channel: 'email' } } })
      return { recipientCount: users.length }
    }, { timeout: 30_000, maxWait: 5_000 })
  }

  async function progress(id: string, page = 1) {
    await reconcileCustomerCampaignResults(prisma)
    const row = await prisma.customerCampaign.findUnique({ where: { id }, select: { status: true, recipientCount: true } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    const safePage = Math.max(1, Math.floor(page))
    const [counts, rows] = await Promise.all([
      prisma.customerCampaignRecipient.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }),
      prisma.customerCampaignRecipient.findMany({ where: { campaignId: id }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], skip: (safePage - 1) * RECIPIENT_PAGE_SIZE, take: RECIPIENT_PAGE_SIZE, select: { id: true, email: true, status: true, statusReason: true, submittedAt: true } }),
    ])
    return { status: row.status, recipientCount: row.recipientCount, counts: Object.fromEntries(counts.map((item) => [item.status, item._count._all])), rows, page: safePage, pageSize: RECIPIENT_PAGE_SIZE }
  }

  async function retryFailed(_actorId: string, id: string, version: number) {
    const row = await prisma.customerCampaign.findUnique({ where: { id }, select: { channel: true, version: true } })
    if (!row) throw new NotFoundError('Müşteri kampanyası')
    if (row.version !== version) throw new ConflictError('Kampanya değişti. Sayfayı yenileyin.')
    await assertMarketingChannelOpen(prisma, row.channel)
    if (row.channel !== 'email') throw new ValidationError('SMS yeniden denemesi desteklenmiyor.')
    return prisma.$transaction(async (tx) => {
      await assertMarketingChannelOpen(tx, 'email')
      const failed = await tx.$queryRaw<{ id: string; eventKey: string }[]>(Prisma.sql`
        SELECT r.id, r."eventKey" FROM customer_campaign_recipients r
        JOIN notification_outbox o ON o."eventKey" = r."eventKey" AND o."userId" = r."userId" AND o.type = 'customer_campaign'
        WHERE r."campaignId" = ${id} AND r."userId" IS NOT NULL AND o.status IN ('failed', 'completed')
          AND r."submittedAt" > now() - interval '24 hours'
          AND EXISTS (SELECT 1 FROM notification_deliveries d WHERE d."eventKey" = r."eventKey" AND d.channel = 'email' AND d.status = 'failed' AND d."transportStatus" <> 'uncertain')
          AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d."eventKey" = r."eventKey" AND d.channel = 'email' AND (d."transportStatus" = 'uncertain' OR d.status IN ('sent', 'processing')))
        ORDER BY r.id FOR UPDATE OF r
      `)
      for (const recipient of failed) {
        await tx.customerCampaignRecipient.update({ where: { id: recipient.id }, data: { status: 'queued', statusReason: null, retryRequestedAt: new Date() } })
        await tx.notificationOutbox.updateMany({ where: { eventKey: recipient.eventKey, type: 'customer_campaign', status: { in: ['failed', 'completed'] } }, data: { status: 'pending', generation: { increment: 1 }, queuedAt: null, lastError: null } })
        await tx.notificationDelivery.updateMany({ where: { eventKey: recipient.eventKey, channel: 'email', status: 'failed', transportStatus: { not: 'uncertain' } }, data: { status: 'pending', lastError: null } })
      }
      if (failed.length) await tx.adminAuditLog.create({ data: { actorId: _actorId, actionType: 'customer_campaign_retry_requested', targetType: 'customer_campaign', targetId: id, newData: { count: failed.length } } })
      return { requeued: failed.length }
    }, { timeout: 30_000, maxWait: 5_000 })
  }

  return { createDraft, updateDraft, deleteDraft, copyCampaign, listForAdmin, getForAdmin, searchCustomers, previewRecipients, submit, progress, retryFailed }
}

/** Bounded outbox writer. The notification worker performs a second consent/IYS/limit gate. */
export async function runCustomerCampaignDispatchSweep(prisma: PrismaClient) {
  await reconcileCustomerCampaignResults(prisma)
  await prisma.customerCampaignRecipient.updateMany({
    where: { status: 'pending', submittedAt: { lte: new Date(Date.now() - 86_400_000) } },
    data: { status: 'skipped', statusReason: 'CAMPAIGN_EXPIRED' },
  })
  const channel = await getMarketingChannelStatus(prisma, 'email')
  if (!channel.canSend) {
    await prisma.customerCampaignRecipient.updateMany({
      where: { status: 'pending' }, data: { status: 'skipped', statusReason: channel.reason },
    })
    return { written: 0, skipped: 0 }
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2s'")
    const [lock] = await tx.$queryRaw<{ locked: boolean }[]>(Prisma.sql`
      SELECT pg_try_advisory_xact_lock(hashtext('hanuja:customer-campaign-dispatch')) AS locked
    `)
    if (!lock?.locked) return { written: 0, skipped: 0, locked: true }
    await assertMarketingChannelOpen(tx, 'email')
    const inFlight = await tx.notificationOutbox.count({ where: { lane: 'bulk', status: { in: ['pending', 'queued'] } } })
    const room = Math.min(SWEEP_BATCH_SIZE, Math.max(0, SWEEP_INFLIGHT_CAP - inFlight))
    if (!room) return { written: 0, skipped: 0, capacity: true }
    const recipients = await tx.$queryRaw<{ id: string; campaignId: string; userId: string; email: string; eventKey: string; title: string }[]>(Prisma.sql`
      SELECT r.id, r."campaignId", r."userId", r.email, r."eventKey", c.title
      FROM customer_campaign_recipients r
      JOIN customer_campaigns c ON c.id = r."campaignId"
      WHERE c.status = 'submitted' AND c.channel = 'email'
        AND r.status = 'pending' AND r."outboxWrittenAt" IS NULL AND r."userId" IS NOT NULL
      ORDER BY r."submittedAt", r.id LIMIT ${room} FOR UPDATE OF r SKIP LOCKED
    `)
    let written = 0
    let skipped = 0
    for (const recipient of recipients) {
      const consent = await tx.marketingConsentAddress.findFirst({ where: {
        userId: recipient.userId, brand: 'hanuja', channel: 'email',
        address: recipient.email.trim().toLowerCase(), status: 'granted',
        revokedAt: null, verifiedIysAt: { not: null },
      }, select: { id: true, optOutToken: true } })
      const user = await tx.user.findUnique({ where: { id: recipient.userId }, select: { role: true, banned: true, email: true } })
      let reason: string | null = null
      if (!user || user.role !== 'customer' || user.banned) reason = 'CUSTOMER_UNAVAILABLE'
      else if (user.email.trim().toLowerCase() !== recipient.email.trim().toLowerCase()) reason = 'ADDRESS_CHANGED'
      else if (!consent) reason = 'CONSENT_OR_IYS_MISSING'
      if (reason || !consent) {
        await tx.customerCampaignRecipient.update({ where: { id: recipient.id }, data: { status: 'skipped', statusReason: reason ?? 'CONSENT_OR_IYS_MISSING' } })
        skipped += 1
        continue
      }
      await lockCampaignUser(tx, recipient.userId)
      const limit = await checkCampaignLimits(tx, { userId: recipient.userId, productId: null, source: 'customer_campaign', now: new Date() })
      if (limit) {
        if (limit === 'daily_cap') continue
        await tx.customerCampaignRecipient.update({ where: { id: recipient.id }, data: { status: 'skipped', statusReason: limit } })
        skipped += 1
        continue
      }
      await tx.campaignEmailDispatch.create({ data: {
        userId: recipient.userId, productId: null, source: 'customer_campaign',
        discountFingerprint: recipient.eventKey, eventKey: recipient.eventKey, status: 'reserved',
      } })
      await recordNotification(tx, {
        eventKey: recipient.eventKey, userId: recipient.userId, type: 'customer_campaign',
        title: recipient.title, body: recipient.title, emailTo: recipient.email,
        data: {
          campaignId: recipient.campaignId, recipientId: recipient.id,
          unsubscribeUrl: `${getWebBaseUrl()}/api/marketing/unsubscribe?token=${encodeURIComponent(consent.optOutToken)}`,
        },
      })
      await tx.customerCampaignRecipient.update({ where: { id: recipient.id }, data: { status: 'queued', outboxWrittenAt: new Date() } })
      written += 1
    }
    return { written, skipped }
  }, { timeout: 10_000, maxWait: 2_000 })
}

/** Project durable delivery outcomes into the campaign report; never turn uncertainty into a retry. */
async function reconcileCustomerCampaignResults(prisma: PrismaClient) {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE customer_campaign_recipients r SET status = CASE
      WHEN d."transportStatus" = 'uncertain' THEN 'uncertain'
      WHEN d."transportStatus" = 'skipped' THEN 'skipped'
      WHEN d.status = 'sent' THEN 'sent'
      WHEN d.status = 'failed' THEN 'failed'
      ELSE 'queued' END,
      "statusReason" = d."lastError", "deliveryId" = d.id, "updatedAt" = now()
    FROM notification_deliveries d
    WHERE d."eventKey" = r."eventKey" AND d.channel = 'email'
      AND d.recipient = lower(trim(r.email))
  `)
  await prisma.$executeRaw(Prisma.sql`
    UPDATE customer_campaign_recipients r SET status = 'skipped', "statusReason" = o."lastError", "updatedAt" = now()
    FROM notification_outbox o
    WHERE o."eventKey" = r."eventKey" AND o.status = 'completed' AND o."lastError" IS NOT NULL
      AND r.status IN ('pending', 'queued')
      AND NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d."eventKey" = r."eventKey" AND d.channel = 'email' AND (d.status IN ('processing','sent') OR d."transportStatus" = 'uncertain'))
  `)
}

/** Frozen rendering data; the job must never read the editable draft fields. */
export async function loadSubmittedCustomerCampaign(
  prisma: PrismaClient,
  campaignId: string,
  recipientId: string,
  userId: string,
) {
  const recipient = await prisma.customerCampaignRecipient.findFirst({
    where: { id: recipientId, campaignId, userId },
    select: { email: true, eventKey: true, campaign: { select: { status: true, channel: true, submittedContent: true } } },
  })
  if (!recipient || recipient.campaign.status !== 'submitted' || recipient.campaign.channel !== 'email' ||
    !recipient.email || !recipient.campaign.submittedContent ||
    typeof recipient.campaign.submittedContent !== 'object' || Array.isArray(recipient.campaign.submittedContent))
    throw new ValidationError('Kampanya teslim verisi bulunamadı.')
  const content = recipient.campaign.submittedContent as Record<string, unknown>
  if (typeof content.title !== 'string' || typeof content.body !== 'string')
    throw new ValidationError('Kampanya içeriği geçersiz.')
  return { recipientEmail: recipient.email, eventKey: recipient.eventKey, content: {
    title: content.title, body: content.body,
    ctaLabel: typeof content.ctaLabel === 'string' ? content.ctaLabel : null,
    ctaUrl: typeof content.ctaUrl === 'string' ? content.ctaUrl : null,
    mediaUrl: typeof content.mediaUrl === 'string' ? content.mediaUrl : null,
    mediaKind: content.mediaKind === 'video' ? 'video' as const : content.mediaKind === 'image' ? 'image' as const : null,
    posterUrl: typeof content.posterUrl === 'string' ? content.posterUrl : null,
  } }
}
