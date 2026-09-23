/**
 * Seller announcements (e-mail plan phase 5).
 *
 * Draft → preview → send. Sending freezes the content (`sentTitle/sentBody`) and the
 * recipient list (one AnnouncementRecipient per seller) in one transaction and writes
 * no outbox rows: the announcement-dispatch sweep materialises them within the bulk
 * lane's capacity. A bulk retry only marks recipients; the sweep requeues them under
 * the same capacity. Editing after send changes the panel copy, never the e-mails.
 */
import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors'
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_ELIGIBLE_STATUSES,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  DEFAULT_ANNOUNCEMENT_AUDIENCE,
  announcementAudienceSchema,
  buildAudienceWhere,
  buildLocationIndex,
  collectCategorySubtree,
  type AnnouncementAudience,
} from '../domain/announcement-audience'
import { announcementEventKey, hashAudience } from '../domain/announcement-keys'
import {
  emptyProgressCounts,
  isAnnouncementProgressBucket,
  safeNotificationErrorCode,
  type AnnouncementProgressBucket,
  type AnnouncementProgressCounts,
} from '../domain/announcement-progress'
import {
  announcementDisplayMedia,
  announcementPanelUrl,
  buildAnnouncementEmail,
  type AnnouncementMediaRef,
} from './announcement-content'

export const ANNOUNCEMENT_ADMIN_PAGE_SIZE = 20
export const ANNOUNCEMENT_RECIPIENT_PAGE_SIZE = 50
export const ANNOUNCEMENT_SELLER_PAGE_SIZE = 30
const RECIPIENT_INSERT_CHUNK = 1000
const SEND_TX_TIMEOUT_MS = 30_000
const EXCLUDED_PREVIEW_LIMIT = 200
const PREVIEW_SELLER_NAME = 'Örnek Mağaza'

type Db = PrismaClient | Prisma.TransactionClient

export interface AnnouncementDraftInput {
  version: number
  title: string
  body: string
  mediaAssetId: string | null
  posterAssetId: string | null
  audience: AnnouncementAudience
}

const mediaSelect = { id: true, url: true, kind: true, originalName: true } as const

function isForeignKeyViolation(error: unknown) {
  return (error as { code?: unknown } | null)?.code === 'P2003'
}

function assertContentLimits(title: string, body: string, forSend: boolean) {
  const t = title.trim()
  const b = body.trim()
  if (t.length > ANNOUNCEMENT_TITLE_MAX)
    throw new ValidationError(`Başlık en fazla ${ANNOUNCEMENT_TITLE_MAX} karakter olabilir.`)
  if (b.length > ANNOUNCEMENT_BODY_MAX)
    throw new ValidationError(`Metin en fazla ${ANNOUNCEMENT_BODY_MAX} karakter olabilir.`)
  if (!forSend) return
  if (t.length < ANNOUNCEMENT_TITLE_MIN)
    throw new ValidationError(`Başlık en az ${ANNOUNCEMENT_TITLE_MIN} karakter olmalı.`)
  if (!b.length) throw new ValidationError('Duyuru metni boş olamaz.')
}

function parseStoredAudience(value: unknown): AnnouncementAudience {
  const parsed = announcementAudienceSchema.safeParse(value)
  if (!parsed.success)
    throw new ValidationError('Kayıtlı alıcı seçimi geçersiz. Alıcıları yeniden seçip kaydedin.')
  return parsed.data
}

/** Only ready media uploaded to the announcements folder may be attached. */
async function assertAttachableMedia(
  db: Db,
  mediaAssetId: string | null,
  posterAssetId: string | null,
): Promise<'image' | 'video' | null> {
  if (!mediaAssetId) {
    if (posterAssetId) throw new ValidationError('Kapak görseli yalnız video ile kullanılabilir.')
    return null
  }
  const ids = posterAssetId ? [mediaAssetId, posterAssetId] : [mediaAssetId]
  const assets = await db.mediaAsset.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, folder: true, kind: true },
  })
  const media = assets.find((asset) => asset.id === mediaAssetId)
  if (
    !media ||
    media.status !== 'ready' ||
    media.folder !== 'announcements' ||
    (media.kind !== 'image' && media.kind !== 'video')
  ) {
    throw new ValidationError('Seçilen medya kullanılamıyor. Lütfen yeniden yükleyin.')
  }
  if (media.kind === 'image' && posterAssetId)
    throw new ValidationError('Kapak görseli yalnız video için seçilebilir.')
  if (posterAssetId) {
    const poster = assets.find((asset) => asset.id === posterAssetId)
    if (!poster || poster.status !== 'ready' || poster.folder !== 'announcements' || poster.kind !== 'image')
      throw new ValidationError('Seçilen kapak görseli kullanılamıyor. Lütfen yeniden yükleyin.')
  }
  return media.kind
}

async function resolveAudienceSellers(db: Db, audience: AnnouncementAudience) {
  const filters = audience.mode === 'filter' ? audience.filters : {}
  const pairs = filters.locations?.length
    ? await db.sellerProfile.findMany({ select: { city: true, district: true } })
    : []
  const categories = filters.categoryIds?.length
    ? await db.category.findMany({ select: { id: true, parentId: true } })
    : []
  const where = buildAudienceWhere(audience, {
    locationIndex: buildLocationIndex(pairs),
    categorySubtreeIds: collectCategorySubtree(categories, filters.categoryIds ?? []),
  })
  return db.seller.findMany({
    where,
    select: { id: true, userId: true, displayName: true },
    orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
  })
}

/**
 * One row per recipient with its delivery bucket. The latest e-mail delivery wins: a
 * seller whose address changed between attempts has one delivery row per address.
 * Precedence mirrors what the admin can act on (see the progress-bucket docs).
 */
function recipientStatusSql(announcementIds: readonly string[]) {
  return Prisma.sql`
    SELECT
      r.id,
      r."announcementId",
      r."sellerId",
      r."sellerName",
      r."eventKey",
      r."sellerDeletedAt",
      r."readAt",
      r."retryRequestedAt",
      o.status AS "outboxStatus",
      d.status::text AS "deliveryStatus",
      d."transportStatus",
      d."lastError",
      d."smtpAcceptedAt",
      d."deliveredAt",
      CASE
        WHEN r."sellerId" IS NULL THEN 'seller_deleted'
        WHEN r."retryRequestedAt" IS NOT NULL THEN 'retry_pending'
        WHEN r."outboxWrittenAt" IS NULL THEN 'preparing'
        WHEN d.status = 'sent' AND d."transportStatus" = 'delivered' THEN 'delivered'
        WHEN d.status = 'sent' AND d."transportStatus" IN ('bounced', 'complained') THEN 'bounced'
        WHEN d.status = 'sent' AND d."transportStatus" = 'skipped' THEN 'skipped'
        WHEN d.status = 'sent' THEN 'accepted'
        WHEN d.status = 'failed' AND d."transportStatus" = 'uncertain' THEN 'uncertain'
        WHEN o.status IN ('pending', 'queued') THEN 'queued'
        WHEN d.status = 'failed' THEN 'failed'
        WHEN d.status IN ('pending', 'processing') THEN 'queued'
        WHEN o.status = 'failed' THEN 'failed'
        WHEN o.status = 'completed' THEN 'skipped'
        ELSE 'queued'
      END AS bucket
    FROM announcement_recipients r
    LEFT JOIN notification_outbox o
      ON o."userId" = r."userId"
     AND o.type = 'seller_announcement'
     AND o."eventKey" = r."eventKey"
    LEFT JOIN LATERAL (
      SELECT nd.status, nd."transportStatus", nd."lastError", nd."smtpAcceptedAt", nd."deliveredAt"
      FROM notification_deliveries nd
      WHERE nd."eventKey" = r."eventKey" AND nd.channel = 'email'
      ORDER BY nd."createdAt" DESC
      LIMIT 1
    ) d ON TRUE
    WHERE r."announcementId" = ANY(${announcementIds as string[]}::text[])
  `
}

/**
 * Recipients a bulk retry may requeue: a final failure (not still retrying in the
 * queue), a live seller, no retry already requested and — like the single-row retry —
 * no uncertain delivery for the event key, since that e-mail may have gone out.
 */
function eligibleRetrySql(announcementId: string) {
  return Prisma.sql`
    WITH rows AS (${recipientStatusSql([announcementId])})
    SELECT rows.id, rows."sellerName", rows."lastError"
    FROM rows
    WHERE rows.bucket = 'failed'
      AND rows."sellerId" IS NOT NULL
      AND rows."outboxStatus" IN ('failed', 'completed')
      AND NOT EXISTS (
        SELECT 1 FROM notification_deliveries u
        WHERE u."eventKey" = rows."eventKey"
          AND u.channel = 'email'
          AND u."transportStatus" = 'uncertain'
      )
    ORDER BY rows."sellerName", rows.id
  `
}

type RecipientStatusRow = {
  id: string
  sellerId: string | null
  sellerName: string
  sellerDeletedAt: Date | null
  readAt: Date | null
  outboxStatus: string | null
  deliveryStatus: string | null
  transportStatus: string | null
  lastError: string | null
  smtpAcceptedAt: Date | null
  deliveredAt: Date | null
  bucket: string
}

async function progressCounts(db: Db, announcementIds: readonly string[]) {
  const result = new Map<string, AnnouncementProgressCounts>()
  if (!announcementIds.length) return result
  const rows = await db.$queryRaw<{ announcementId: string; bucket: string; count: number }[]>(
    Prisma.sql`
      WITH rows AS (${recipientStatusSql(announcementIds)})
      SELECT "announcementId", bucket, count(*)::int AS count
      FROM rows
      GROUP BY "announcementId", bucket
    `,
  )
  for (const row of rows) {
    const counts = result.get(row.announcementId) ?? emptyProgressCounts()
    if (isAnnouncementProgressBucket(row.bucket)) counts[row.bucket] += Number(row.count)
    result.set(row.announcementId, counts)
  }
  return result
}

export function createAnnouncementService({ prisma }: { prisma: PrismaClient }) {
  async function explainDraftConflict(id: string): Promise<never> {
    const row = await prisma.announcement.findUnique({ where: { id }, select: { status: true } })
    if (!row) throw new NotFoundError('Duyuru')
    if (row.status === 'sent')
      throw new ConflictError('Duyuru gönderildi; artık taslak olarak düzenlenemez.')
    throw new ConflictError(
      'Taslak başka bir sekmede veya başka bir yönetici tarafından değiştirildi. Sayfayı yenileyin.',
    )
  }

  async function createDraft(actorId: string) {
    const created = await prisma.announcement.create({
      data: {
        title: '',
        body: '',
        audience: DEFAULT_ANNOUNCEMENT_AUDIENCE as unknown as Prisma.InputJsonValue,
        createdByAdminId: actorId,
      },
      select: { id: true },
    })
    return created
  }

  async function updateDraft(id: string, input: AnnouncementDraftInput) {
    assertContentLimits(input.title, input.body, false)
    const audience = announcementAudienceSchema.parse(input.audience)
    await assertAttachableMedia(prisma, input.mediaAssetId, input.posterAssetId)
    try {
      const result = await prisma.announcement.updateMany({
        where: { id, status: 'draft', version: input.version },
        data: {
          title: input.title.trim(),
          body: input.body.trim(),
          mediaAssetId: input.mediaAssetId,
          posterAssetId: input.posterAssetId,
          audience: audience as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      })
      if (!result.count) await explainDraftConflict(id)
    } catch (error) {
      // The media row was deleted between the check and the write (FK Restrict + row lock).
      if (isForeignKeyViolation(error))
        throw new ValidationError('Seçilen medya silinmiş. Lütfen yeniden seçin.')
      throw error
    }
    return { version: input.version + 1 }
  }

  async function deleteDraft(id: string) {
    const result = await prisma.announcement.deleteMany({ where: { id, status: 'draft' } })
    if (!result.count) {
      const row = await prisma.announcement.findUnique({ where: { id }, select: { status: true } })
      if (!row) throw new NotFoundError('Duyuru')
      throw new ConflictError('Gönderilmiş duyuru silinemez.')
    }
    return { deleted: true }
  }

  async function listForAdmin(page = 1) {
    const safePage = Math.max(1, Math.floor(page))
    const [rows, total] = await Promise.all([
      prisma.announcement.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * ANNOUNCEMENT_ADMIN_PAGE_SIZE,
        take: ANNOUNCEMENT_ADMIN_PAGE_SIZE,
        select: {
          id: true,
          status: true,
          title: true,
          recipientCount: true,
          sentAt: true,
          editedAfterSendAt: true,
          createdAt: true,
        },
      }),
      prisma.announcement.count(),
    ])
    const counts = await progressCounts(
      prisma,
      rows.filter((row) => row.status === 'sent').map((row) => row.id),
    )
    return {
      page: safePage,
      pageSize: ANNOUNCEMENT_ADMIN_PAGE_SIZE,
      total,
      rows: rows.map((row) => ({ ...row, progress: counts.get(row.id) ?? null })),
    }
  }

  async function getForAdmin(id: string) {
    const row = await prisma.announcement.findUnique({
      where: { id },
      include: { mediaAsset: { select: mediaSelect }, posterAsset: { select: mediaSelect } },
    })
    if (!row) throw new NotFoundError('Duyuru')
    const parsed = announcementAudienceSchema.safeParse(row.audience)
    const audience = parsed.success ? parsed.data : DEFAULT_ANNOUNCEMENT_AUDIENCE
    const manualSellers = audience.manualSellerIds.length
      ? await prisma.seller.findMany({
          where: { id: { in: audience.manualSellerIds } },
          select: { id: true, displayName: true, status: true },
        })
      : []
    const display = announcementDisplayMedia(
      row.mediaAsset as AnnouncementMediaRef | null,
      row.posterAsset as AnnouncementMediaRef | null,
    )
    return {
      id: row.id,
      status: row.status,
      version: row.version,
      title: row.title,
      body: row.body,
      audience,
      audienceInvalid: !parsed.success,
      manualSellers,
      media: row.mediaAsset
        ? { id: row.mediaAsset.id, kind: row.mediaAsset.kind, originalName: row.mediaAsset.originalName }
        : null,
      poster: row.posterAsset
        ? { id: row.posterAsset.id, kind: row.posterAsset.kind, originalName: row.posterAsset.originalName }
        : null,
      displayMedia: display,
      sentTitle: row.sentTitle,
      sentBody: row.sentBody,
      sentAt: row.sentAt,
      recipientCount: row.recipientCount,
      audienceHash: row.audienceHash,
      editedAfterSendAt: row.editedAfterSendAt,
      createdAt: row.createdAt,
      panelUrl: announcementPanelUrl(row.id),
    }
  }

  async function getFilterOptions() {
    const [pairs, categories] = await Promise.all([
      prisma.sellerProfile.findMany({
        where: { seller: { status: { in: [...ANNOUNCEMENT_ELIGIBLE_STATUSES] } } },
        select: { city: true, district: true },
      }),
      prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true, parentId: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ])
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, 'tr')
    const locations = [...buildLocationIndex(pairs).values()]
      .map((city) => ({
        key: city.key,
        label: city.label,
        count: city.count,
        districts: [...city.districts.values()]
          .map((district) => ({ key: district.key, label: district.label, count: district.count }))
          .sort(byLabel),
      }))
      .sort(byLabel)
    return {
      statuses: [
        { value: 'active' as const, label: 'Aktif' },
        { value: 'suspended' as const, label: 'Askıda' },
      ],
      locations,
      categories: categories.map(({ id, name, parentId }) => ({ id, name, parentId })),
    }
  }

  async function searchSellers(query: string) {
    const q = query.trim()
    if (q.length < 2) return []
    const rows = await prisma.seller.findMany({
      where: {
        status: { in: [...ANNOUNCEMENT_ELIGIBLE_STATUSES] },
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
          { profile: { is: { companyName: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      select: {
        id: true,
        displayName: true,
        status: true,
        profile: { select: { companyName: true, city: true, district: true } },
      },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: 20,
    })
    return rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      status: row.status,
      companyName: row.profile?.companyName ?? null,
      city: row.profile?.city ?? null,
      district: row.profile?.district ?? null,
    }))
  }

  /** The exact list a send would freeze for the saved draft, bound by version + hash. */
  async function previewRecipients(id: string, page = 1) {
    const row = await prisma.announcement.findUnique({
      where: { id },
      select: { status: true, version: true, audience: true },
    })
    if (!row) throw new NotFoundError('Duyuru')
    if (row.status !== 'draft') throw new ConflictError('Gönderilmiş duyurunun alıcı listesi dondurulmuştur.')
    const audience = parseStoredAudience(row.audience)
    const sellers = await resolveAudienceSellers(prisma, audience)
    const ids = sellers.map((seller) => seller.id)
    const safePage = Math.max(1, Math.floor(page))
    const pageIds = ids.slice(
      (safePage - 1) * ANNOUNCEMENT_RECIPIENT_PAGE_SIZE,
      safePage * ANNOUNCEMENT_RECIPIENT_PAGE_SIZE,
    )
    const [details, excluded] = await Promise.all([
      pageIds.length
        ? prisma.seller.findMany({
            where: { id: { in: pageIds } },
            select: {
              id: true,
              displayName: true,
              status: true,
              createdAt: true,
              profile: { select: { companyName: true, city: true, district: true, isVerified: true } },
            },
          })
        : [],
      audience.excludedSellerIds.length
        ? prisma.seller.findMany({
            where: { id: { in: audience.excludedSellerIds.slice(0, EXCLUDED_PREVIEW_LIMIT) } },
            select: { id: true, displayName: true },
            orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
          })
        : [],
    ])
    const byId = new Map(details.map((detail) => [detail.id, detail]))
    return {
      version: row.version,
      count: ids.length,
      audienceHash: hashAudience(ids),
      page: safePage,
      pageSize: ANNOUNCEMENT_RECIPIENT_PAGE_SIZE,
      rows: pageIds.flatMap((sellerId) => {
        const detail = byId.get(sellerId)
        if (!detail) return []
        return [
          {
            id: detail.id,
            displayName: detail.displayName,
            status: detail.status,
            createdAt: detail.createdAt,
            companyName: detail.profile?.companyName ?? null,
            city: detail.profile?.city ?? null,
            district: detail.profile?.district ?? null,
            isVerified: detail.profile?.isVerified ?? false,
          },
        ]
      }),
      excluded: { count: audience.excludedSellerIds.length, rows: excluded },
    }
  }

  async function renderEmailPreview(id: string) {
    const row = await prisma.announcement.findUnique({
      where: { id },
      include: {
        mediaAsset: { select: { url: true, kind: true } },
        posterAsset: { select: { url: true, kind: true } },
      },
    })
    if (!row) throw new NotFoundError('Duyuru')
    const title = (row.status === 'sent' ? row.sentTitle : row.title) ?? ''
    const body = (row.status === 'sent' ? row.sentBody : row.body) ?? ''
    return buildAnnouncementEmail({
      sellerName: PREVIEW_SELLER_NAME,
      title: title.trim() || 'Başlıksız duyuru',
      body,
      media: row.mediaAsset as AnnouncementMediaRef | null,
      poster: row.posterAsset as AnnouncementMediaRef | null,
      panelUrl: announcementPanelUrl(row.id),
    })
  }

  async function send(actorId: string, id: string, input: { version: number; audienceHash: string }) {
    return prisma.$transaction(
      async (tx) => {
        // Row lock: a second click, a draft save or a delete waits here and then loses.
        const locked = await tx.$queryRaw<{ status: string; version: number }[]>(
          Prisma.sql`SELECT status::text AS status, version FROM announcements WHERE id = ${id} FOR UPDATE`,
        )
        const current = locked[0]
        if (!current) throw new NotFoundError('Duyuru')
        if (current.status !== 'draft') throw new ConflictError('Bu duyuru zaten gönderildi.')
        if (Number(current.version) !== input.version)
          throw new ConflictError('Taslak önizlemeden sonra değişti. Önizlemeyi yenileyip tekrar gönderin.')

        const draft = await tx.announcement.findUniqueOrThrow({
          where: { id },
          select: { title: true, body: true, mediaAssetId: true, posterAssetId: true, audience: true },
        })
        assertContentLimits(draft.title, draft.body, true)
        const mediaKind = await assertAttachableMedia(tx, draft.mediaAssetId, draft.posterAssetId)
        if (mediaKind === 'video' && !draft.posterAssetId)
          throw new ValidationError('Video için kapak görseli zorunludur.')

        const audience = parseStoredAudience(draft.audience)
        const sellers = await resolveAudienceSellers(tx, audience)
        if (!sellers.length) throw new ValidationError('Alıcı listesi boş; en az bir satıcı seçin.')
        const audienceHash = hashAudience(sellers.map((seller) => seller.id))
        if (audienceHash !== input.audienceHash)
          throw new ConflictError(
            'Alıcı listesi önizlemeden sonra değişti. Önizlemeyi yenileyip tekrar gönderin.',
          )

        for (let start = 0; start < sellers.length; start += RECIPIENT_INSERT_CHUNK) {
          await tx.announcementRecipient.createMany({
            data: sellers.slice(start, start + RECIPIENT_INSERT_CHUNK).map((seller) => ({
              announcementId: id,
              sellerId: seller.id,
              userId: seller.userId,
              sellerName: seller.displayName,
              eventKey: announcementEventKey(id, seller.id),
            })),
          })
        }

        const title = draft.title.trim()
        const body = draft.body.trim()
        await tx.announcement.update({
          where: { id },
          data: {
            status: 'sent',
            title,
            body,
            sentTitle: title,
            sentBody: body,
            sentAt: new Date(),
            sentByAdminId: actorId,
            audienceHash,
            recipientCount: sellers.length,
            version: { increment: 1 },
          },
        })
        await tx.adminAuditLog.create({
          data: {
            actorId,
            actionType: 'announcement_sent',
            targetType: 'announcement',
            targetId: id,
            newData: {
              title,
              recipientCount: sellers.length,
              audienceHash,
              mediaKind,
              audience: audience as unknown as Prisma.InputJsonValue,
            },
          },
        })
        return { recipientCount: sellers.length }
      },
      { timeout: SEND_TX_TIMEOUT_MS, maxWait: 5_000 },
    )
  }

  /** Changes the panel copy only; e-mails keep the frozen content and are not resent. */
  async function updateAfterSend(
    actorId: string,
    id: string,
    input: { version: number; title: string; body: string },
  ) {
    assertContentLimits(input.title, input.body, true)
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string; version: number }[]>(
        Prisma.sql`SELECT status::text AS status, version FROM announcements WHERE id = ${id} FOR UPDATE`,
      )
      const current = locked[0]
      if (!current) throw new NotFoundError('Duyuru')
      if (current.status !== 'sent') throw new ConflictError('Yalnız gönderilmiş duyuru bu yolla düzenlenir.')
      if (Number(current.version) !== input.version)
        throw new ConflictError('Duyuru başka bir yerde değiştirildi. Sayfayı yenileyin.')
      const previous = await tx.announcement.findUniqueOrThrow({
        where: { id },
        select: { title: true, body: true },
      })
      const title = input.title.trim()
      const body = input.body.trim()
      if (previous.title === title && previous.body === body) return { version: input.version, changed: false }
      await tx.announcement.update({
        where: { id },
        data: { title, body, editedAfterSendAt: new Date(), version: { increment: 1 } },
      })
      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'announcement_updated_after_send',
          targetType: 'announcement',
          targetId: id,
          previousData: previous,
          newData: { title, body },
        },
      })
      return { version: input.version + 1, changed: true }
    })
  }

  async function progress(id: string, options: { bucket?: AnnouncementProgressBucket | null; page?: number } = {}) {
    const row = await prisma.announcement.findUnique({
      where: { id },
      select: { status: true, recipientCount: true },
    })
    if (!row) throw new NotFoundError('Duyuru')
    const counts = (await progressCounts(prisma, [id])).get(id) ?? emptyProgressCounts()
    const [meta] = await prisma.$queryRaw<{ awaiting: number; lastAccepted: Date | null }[]>(Prisma.sql`
      WITH rows AS (${recipientStatusSql([id])})
      SELECT
        count(*) FILTER (WHERE bucket = 'accepted' AND "transportStatus" = 'unknown')::int AS awaiting,
        max("smtpAcceptedAt") AS "lastAccepted"
      FROM rows
    `)
    const safePage = Math.max(1, Math.floor(options.page ?? 1))
    const bucketFilter = options.bucket ? Prisma.sql`bucket = ${options.bucket}` : Prisma.sql`TRUE`
    const rows = await prisma.$queryRaw<RecipientStatusRow[]>(Prisma.sql`
      WITH rows AS (${recipientStatusSql([id])})
      SELECT * FROM rows
      WHERE ${bucketFilter}
      ORDER BY "sellerName", id
      LIMIT ${ANNOUNCEMENT_RECIPIENT_PAGE_SIZE}
      OFFSET ${(safePage - 1) * ANNOUNCEMENT_RECIPIENT_PAGE_SIZE}
    `)
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    return {
      status: row.status,
      recipientCount: row.recipientCount,
      total,
      counts,
      awaitingResultCount: Number(meta?.awaiting ?? 0),
      lastSmtpAcceptedAt: meta?.lastAccepted ?? null,
      page: safePage,
      pageSize: ANNOUNCEMENT_RECIPIENT_PAGE_SIZE,
      filteredTotal: options.bucket ? counts[options.bucket] : total,
      rows: rows.map((recipient) => ({
        id: recipient.id,
        sellerName: recipient.sellerName,
        bucket: isAnnouncementProgressBucket(recipient.bucket) ? recipient.bucket : 'queued',
        sellerDeleted: recipient.sellerId === null,
        /** For a deleted seller: the dispatch had already completed before the deletion. */
        dispatchCompleted: recipient.outboxStatus === 'completed',
        lastError: safeNotificationErrorCode(recipient.lastError),
        smtpAcceptedAt: recipient.smtpAcceptedAt,
        deliveredAt: recipient.deliveredAt,
        readAt: recipient.readAt,
      })),
    }
  }

  async function retryPreview(id: string) {
    const row = await prisma.announcement.findUnique({ where: { id }, select: { status: true } })
    if (!row) throw new NotFoundError('Duyuru')
    if (row.status !== 'sent') throw new ConflictError('Duyuru henüz gönderilmedi.')
    const eligible = await prisma.$queryRaw<{ id: string; sellerName: string; lastError: string | null }[]>(
      eligibleRetrySql(id),
    )
    const counts = (await progressCounts(prisma, [id])).get(id) ?? emptyProgressCounts()
    return {
      eligibleCount: eligible.length,
      eligibleHash: hashAudience(eligible.map((recipient) => recipient.id)),
      eligible: eligible.map((recipient) => ({
        id: recipient.id,
        sellerName: recipient.sellerName,
        lastError: safeNotificationErrorCode(recipient.lastError),
      })),
      notEligible: {
        uncertain: counts.uncertain,
        failedButSellerDeleted: counts.seller_deleted,
        stillInProgress: counts.preparing + counts.queued + counts.retry_pending,
        failedTotal: counts.failed,
      },
    }
  }

  /**
   * Marks the previewed failed recipients for a retry. Nothing is requeued here: the
   * announcement-dispatch sweep does it within the bulk lane's capacity, re-checking
   * the same guards, so a retry of thousands never floods the queue.
   */
  async function retryFailed(actorId: string, id: string, input: { reason: string; eligibleHash: string }) {
    const reason = input.reason.trim()
    if (reason.length < 10 || reason.length > 500)
      throw new ValidationError('En az 10, en fazla 500 karakterlik yeniden deneme gerekçesi yazın.')
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>(
        Prisma.sql`SELECT status::text AS status FROM announcements WHERE id = ${id} FOR UPDATE`,
      )
      if (!locked[0]) throw new NotFoundError('Duyuru')
      if (locked[0].status !== 'sent') throw new ConflictError('Duyuru henüz gönderilmedi.')
      const eligible = await tx.$queryRaw<{ id: string }[]>(eligibleRetrySql(id))
      const ids = eligible.map((recipient) => recipient.id)
      if (!ids.length) throw new ValidationError('Yeniden denenecek başarısız alıcı yok.')
      if (hashAudience(ids) !== input.eligibleHash)
        throw new ConflictError('Başarısız alıcı listesi önizlemeden sonra değişti. Önizlemeyi yenileyin.')
      const flagged = await tx.announcementRecipient.updateMany({
        where: { id: { in: ids }, announcementId: id, retryRequestedAt: null, sellerId: { not: null } },
        data: { retryRequestedAt: new Date() },
      })
      await tx.adminAuditLog.create({
        data: {
          actorId,
          actionType: 'announcement_retry_requested',
          targetType: 'announcement',
          targetId: id,
          reason,
          newData: { requestedCount: flagged.count, eligibleHash: input.eligibleHash },
        },
      })
      return { requestedCount: flagged.count }
    })
  }

  // ── Seller side ────────────────────────────────────────────────────────────

  async function listForSeller(sellerId: string, page = 1) {
    const safePage = Math.max(1, Math.floor(page))
    const where = { sellerId }
    const [rows, total] = await Promise.all([
      prisma.announcementRecipient.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * ANNOUNCEMENT_SELLER_PAGE_SIZE,
        take: ANNOUNCEMENT_SELLER_PAGE_SIZE,
        select: {
          readAt: true,
          announcement: {
            select: {
              id: true,
              title: true,
              body: true,
              sentAt: true,
              editedAfterSendAt: true,
              mediaAsset: { select: { kind: true } },
            },
          },
        },
      }),
      prisma.announcementRecipient.count({ where }),
    ])
    return {
      page: safePage,
      pageSize: ANNOUNCEMENT_SELLER_PAGE_SIZE,
      total,
      rows: rows.map(({ readAt, announcement }) => ({
        id: announcement.id,
        title: announcement.title,
        excerpt: announcement.body.length > 160 ? `${announcement.body.slice(0, 159)}…` : announcement.body,
        sentAt: announcement.sentAt,
        edited: announcement.editedAfterSendAt !== null,
        mediaKind: announcement.mediaAsset?.kind ?? null,
        unread: readAt === null,
      })),
    }
  }

  async function getForSeller(sellerId: string, announcementId: string) {
    const recipient = await prisma.announcementRecipient.findFirst({
      where: { announcementId, sellerId },
      select: {
        readAt: true,
        announcement: {
          select: {
            id: true,
            title: true,
            body: true,
            sentAt: true,
            editedAfterSendAt: true,
            mediaAsset: { select: { url: true, kind: true } },
            posterAsset: { select: { url: true, kind: true } },
          },
        },
      },
    })
    if (!recipient) throw new NotFoundError('Duyuru')
    const { announcement } = recipient
    return {
      id: announcement.id,
      title: announcement.title,
      body: announcement.body,
      sentAt: announcement.sentAt,
      editedAt: announcement.editedAfterSendAt,
      media: announcementDisplayMedia(
        announcement.mediaAsset as AnnouncementMediaRef | null,
        announcement.posterAsset as AnnouncementMediaRef | null,
      ),
      unread: recipient.readAt === null,
    }
  }

  /** Idempotent: only the first view writes a timestamp. */
  async function markRead(sellerId: string, announcementId: string) {
    const result = await prisma.announcementRecipient.updateMany({
      where: { announcementId, sellerId, readAt: null },
      data: { readAt: new Date() },
    })
    if (result.count) return { advanced: true }
    const exists = await prisma.announcementRecipient.count({ where: { announcementId, sellerId } })
    if (!exists) throw new NotFoundError('Duyuru')
    return { advanced: false }
  }

  async function countUnreadForSeller(sellerId: string) {
    return prisma.announcementRecipient.count({ where: { sellerId, readAt: null } })
  }

  return {
    createDraft,
    updateDraft,
    deleteDraft,
    listForAdmin,
    getForAdmin,
    getFilterOptions,
    searchSellers,
    previewRecipients,
    renderEmailPreview,
    send,
    updateAfterSend,
    progress,
    retryPreview,
    retryFailed,
    listForSeller,
    getForSeller,
    markRead,
    countUnreadForSeller,
  }
}
