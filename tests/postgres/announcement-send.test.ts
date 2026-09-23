/**
 * Seller announcements (e-mail plan phase 5) against a real PostgreSQL database:
 * row locks, advisory locks, SKIP LOCKED, unique indexes and FK behaviour are what
 * make the send, the capacity-bounded sweep, the bulk retry and media deletion safe,
 * and a mocked client cannot show any of them.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/client'

const h = vi.hoisted(() => ({
  send: vi.fn(),
  deletedKeys: [] as string[],
}))
vi.mock('../../api/lib/mailer', () => ({ sendEmail: h.send }))
vi.mock('../../api/lib/prisma', () => ({
  get prisma() {
    return prisma
  },
}))
vi.mock('../../api/lib/r2', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/lib/r2')>()),
  deleteObject: vi.fn(async (key: string) => {
    h.deletedKeys.push(key)
  }),
}))

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error('NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Refusing non-local notification test database')
const schema = `announcement_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
url.searchParams.set('connection_limit', '12')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })

import { createAnnouncementService } from '../../api/services/announcement.service'
import { runAnnouncementDispatchSweep } from '../../api/services/announcement-dispatch.service'
import { createAdminSellerManagementService } from '../../api/services/admin-seller-management.service'
import { createMediaService } from '../../api/services/media.service'
import { processNotificationDispatch } from '../../api/jobs/notification-dispatch.job'
import { ConflictError } from '../../api/lib/errors'
import type { AnnouncementAudience } from '../../api/domain/announcement-audience'

const service = () => createAnnouncementService({ prisma })

beforeAll(async () => {
  execFileSync(
    process.execPath,
    [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  )
  await prisma.$connect()
}, 120_000)

afterAll(async () => {
  if (!/^announcement_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

beforeEach(() => {
  h.send.mockReset().mockResolvedValue({ messageId: '<m@test>', providerMessageId: randomUUID(), transport: 'smtp' })
  h.deletedKeys.length = 0
})

// ── Fixtures ────────────────────────────────────────────────────────────────

interface SellerSeed {
  tag: string
  name?: string
  status?: 'active' | 'suspended' | 'pending' | 'rejected'
  profile?: { city?: string; district?: string; isVerified?: boolean; companyName?: string } | null
  createdAt?: Date
  categoryId?: string
}

async function seedSeller(seed: SellerSeed) {
  const suffix = randomUUID().slice(0, 12)
  const user = await prisma.user.create({ data: { email: `s-${suffix}@example.test`, role: 'seller' } })
  const seller = await prisma.seller.create({
    data: {
      userId: user.id,
      slug: `m-${suffix}`,
      displayName: `${seed.tag} ${seed.name ?? suffix}`,
      status: seed.status ?? 'active',
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
      ...(seed.profile === null ? {} : { profile: { create: { ...(seed.profile ?? {}) } } }),
    },
  })
  if (seed.categoryId) {
    await prisma.product.create({
      data: {
        sellerId: seller.id,
        categoryId: seed.categoryId,
        slug: `u-${suffix}`,
        name: 'Ürün',
        status: 'published',
        price: new Decimal('100.00'),
        stockQuantity: 1,
      },
    })
  }
  return seller
}

/** Many eligible sellers in two statements (users, then sellers). */
async function seedManySellers(tag: string, count: number) {
  const users = Array.from({ length: count }, () => {
    const suffix = randomUUID()
    return { id: `u${suffix.replaceAll('-', '')}`, email: `bulk-${suffix}@example.test`, role: 'seller' as const }
  })
  await prisma.user.createMany({ data: users })
  await prisma.seller.createMany({
    data: users.map((user, index) => ({
      userId: user.id,
      slug: `bulk-${user.id}`,
      displayName: `${tag} ${String(index).padStart(5, '0')}`,
      status: 'active' as const,
    })),
  })
}

async function seedAdmin() {
  return prisma.user.create({ data: { email: `a-${randomUUID()}@example.test`, role: 'admin' } })
}

function audience(overrides: Partial<AnnouncementAudience> = {}): AnnouncementAudience {
  return { mode: 'filter', filters: {}, manualSellerIds: [], excludedSellerIds: [], ...overrides }
}

async function seedDraft(adminId: string, selection: AnnouncementAudience) {
  return prisma.announcement.create({
    data: {
      title: 'Kargo kuralı değişti',
      body: 'Yeni kargo kuralı 1 Ekim itibarıyla geçerlidir.',
      audience: selection as unknown as Prisma.InputJsonValue,
      createdByAdminId: adminId,
    },
  })
}

async function previewIds(announcementId: string) {
  const ids: string[] = []
  for (let page = 1; ; page += 1) {
    const result = await service().previewRecipients(announcementId, page)
    ids.push(...result.rows.map((row) => row.id))
    if (page * result.pageSize >= result.count) return { ids, result }
  }
}

async function sendDraft(adminId: string, announcementId: string) {
  const { result } = await previewIds(announcementId)
  await service().send(adminId, announcementId, { version: result.version, audienceHash: result.audienceHash })
  return result.count
}

/** The sweep is global; park other tests' recipients and queued bulk rows. */
async function isolateSweep(announcementId: string) {
  await prisma.announcementRecipient.updateMany({
    where: { announcementId: { not: announcementId }, outboxWrittenAt: null },
    data: { outboxWrittenAt: new Date() },
  })
  await prisma.announcementRecipient.updateMany({
    where: { announcementId: { not: announcementId }, retryRequestedAt: { not: null } },
    data: { retryRequestedAt: null },
  })
  await prisma.notificationOutbox.updateMany({
    where: { status: { in: ['pending', 'queued'] } },
    data: { status: 'completed' },
  })
}

async function fillBulkLane(rows: number) {
  await prisma.notificationOutbox.createMany({
    data: Array.from({ length: rows }, () => ({
      eventKey: `filler:${randomUUID()}`,
      userId: `filler-${randomUUID()}`,
      type: 'product_discount_favorited',
      lane: 'bulk',
      payload: {},
    })),
  })
}

/** Simulates the bulk worker finishing: every in-flight row, or only the filler rows. */
async function drainBulkLane(options: { fillersOnly?: boolean } = {}) {
  await prisma.notificationOutbox.updateMany({
    where: {
      lane: 'bulk',
      status: { in: ['pending', 'queued'] },
      ...(options.fillersOnly ? { eventKey: { startsWith: 'filler:' } } : {}),
    },
    data: { status: 'completed' },
  })
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('announcement audience against real data', () => {
  it('ORs values within a filter, ANDs filters, keeps eligibility and applies exclusions', async () => {
    const admin = await seedAdmin()
    const tag = `aud-${randomUUID().slice(0, 8)}`
    const root = await prisma.category.create({ data: { slug: `k-${tag}`, name: 'Ev' } })
    const leaf = await prisma.category.create({ data: { slug: `k-${tag}-leaf`, name: 'Sehpa', parentId: root.id } })
    const other = await prisma.category.create({ data: { slug: `k-${tag}-other`, name: 'Ofis' } })
    const day2 = new Date('2026-09-02T09:00:00.000Z')

    const s1 = await seedSeller({
      tag, name: 's1', profile: { city: 'İstanbul', district: 'Kadıköy', isVerified: true },
      createdAt: new Date('2026-08-31T21:30:00.000Z'), categoryId: leaf.id,
    })
    const s2 = await seedSeller({
      tag, name: 's2', status: 'suspended', profile: { city: 'istanbul ', district: 'Merkez', isVerified: false }, createdAt: day2,
    })
    await seedSeller({ tag, name: 's3', status: 'pending', profile: { city: 'İstanbul' }, createdAt: day2 })
    const s4 = await seedSeller({ tag, name: 's4', profile: { city: 'Amasya', district: 'Merkez' }, createdAt: day2 })
    const s5 = await seedSeller({
      tag, name: 's5', profile: { city: 'Ankara', isVerified: true, companyName: 'Noa Ticaret' }, createdAt: day2, categoryId: other.id,
    })
    const s6 = await seedSeller({ tag, name: 's6', profile: null, createdAt: day2 })

    const draft = await seedDraft(admin.id, audience())
    const resolveWith = async (filters: AnnouncementAudience['filters'], extra: Partial<AnnouncementAudience> = {}) => {
      await prisma.announcement.update({
        where: { id: draft.id },
        data: { audience: audience({ filters: { nameQuery: tag, ...filters }, ...extra }) as unknown as Prisma.InputJsonValue },
      })
      return (await previewIds(draft.id)).ids.sort()
    }
    const sorted = (...ids: string[]) => ids.sort()

    expect(await resolveWith({})).toEqual(sorted(s1.id, s2.id, s4.id, s5.id, s6.id))
    expect(await resolveWith({ locations: [{ city: 'istanbul' }] })).toEqual(sorted(s1.id, s2.id))
    expect(
      await resolveWith({ locations: [{ city: 'istanbul', district: 'merkez' }, { city: 'amasya' }] }),
    ).toEqual(sorted(s2.id, s4.id))
    expect(await resolveWith({ verification: ['unverified'] })).toEqual(sorted(s2.id, s4.id, s6.id))
    expect(
      await resolveWith({ locations: [{ city: 'istanbul' }], verification: ['unverified'] }),
    ).toEqual([s2.id])
    expect(await resolveWith({ categoryIds: [root.id] })).toEqual([s1.id])
    expect(await resolveWith({ registeredFrom: '2026-09-01', registeredTo: '2026-09-01' })).toEqual([s1.id])
    expect(await resolveWith({ statuses: ['suspended'] })).toEqual([s2.id])
    expect(await resolveWith({ nameQuery: 'noa ticaret' })).toEqual([s5.id])
    expect(
      await resolveWith({ locations: [{ city: 'istanbul' }] }, { excludedSellerIds: [s1.id] }),
    ).toEqual([s2.id])
  })
})

describe('sending', () => {
  it('freezes content and recipients exactly once under five concurrent sends', async () => {
    const admin = await seedAdmin()
    const tag = `send-${randomUUID().slice(0, 8)}`
    for (let index = 0; index < 3; index += 1) await seedSeller({ tag })
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    const { result } = await previewIds(draft.id)

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        service().send(admin.id, draft.id, { version: result.version, audienceHash: result.audienceHash }),
      ),
    )
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    for (const outcome of outcomes.filter((o) => o.status === 'rejected'))
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError)

    const sent = await prisma.announcement.findUniqueOrThrow({ where: { id: draft.id } })
    expect(sent).toMatchObject({ status: 'sent', recipientCount: 3, sentTitle: 'Kargo kuralı değişti' })
    expect(await prisma.announcementRecipient.count({ where: { announcementId: draft.id } })).toBe(3)
    // The send never writes outbox rows; the sweep does.
    expect(
      await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: `announcement:${draft.id}:` } } }),
    ).toBe(0)
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: draft.id, actionType: 'announcement_sent' } }),
    ).toBe(1)
  })

  it('refuses a stale recipient list or version and writes nothing', async () => {
    const admin = await seedAdmin()
    const tag = `stale-${randomUUID().slice(0, 8)}`
    await seedSeller({ tag })
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    const { result } = await previewIds(draft.id)

    await seedSeller({ tag }) // a new seller now matches the filter
    await expect(
      service().send(admin.id, draft.id, { version: result.version, audienceHash: result.audienceHash }),
    ).rejects.toBeInstanceOf(ConflictError)

    const fresh = (await previewIds(draft.id)).result
    await service().updateDraft(draft.id, {
      version: fresh.version,
      title: 'Yeni başlık',
      body: 'Metin',
      mediaAssetId: null,
      posterAssetId: null,
      audience: audience({ filters: { nameQuery: tag } }),
    })
    await expect(
      service().send(admin.id, draft.id, { version: fresh.version, audienceHash: fresh.audienceHash }),
    ).rejects.toBeInstanceOf(ConflictError)

    expect(await prisma.announcementRecipient.count({ where: { announcementId: draft.id } })).toBe(0)
    expect((await prisma.announcement.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('draft')
  })
})

describe('dispatch sweep', () => {
  it('fills only the shared bulk capacity across parallel sweeps, one outbox row per recipient', async () => {
    const admin = await seedAdmin()
    const tag = `cap-${randomUUID().slice(0, 8)}`
    await seedManySellers(tag, 2500)
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    expect(await sendDraft(admin.id, draft.id)).toBe(2500)
    await isolateSweep(draft.id)
    await fillBulkLane(40)

    const results = await Promise.all([1, 2, 3].map(() => runAnnouncementDispatchSweep(prisma)))
    expect(results.reduce((sum, result) => sum + result.written, 0)).toBe(60)
    expect(await prisma.notificationOutbox.count({ where: { lane: 'bulk', status: 'pending' } })).toBe(100)

    // Drain and repeat until every recipient is materialised, never more than 100 in flight.
    for (let tick = 0; tick < 40; tick += 1) {
      await drainBulkLane()
      const outcome = await Promise.all([runAnnouncementDispatchSweep(prisma), runAnnouncementDispatchSweep(prisma)])
      expect(outcome.reduce((sum, result) => sum + result.written, 0)).toBeLessThanOrEqual(100)
      if (!(await prisma.announcementRecipient.count({ where: { announcementId: draft.id, outboxWrittenAt: null } })))
        break
    }
    expect(
      await prisma.announcementRecipient.count({ where: { announcementId: draft.id, outboxWrittenAt: null } }),
    ).toBe(0)
    expect(
      await prisma.notificationOutbox.count({
        where: { type: 'seller_announcement', eventKey: { startsWith: `announcement:${draft.id}:` } },
      }),
    ).toBe(2500)
  }, 120_000)

  it('rolls back within the lock timeout when a row it needs is locked, then succeeds', async () => {
    const admin = await seedAdmin()
    const tag = `lock-${randomUUID().slice(0, 8)}`
    await seedSeller({ tag })
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    await sendDraft(admin.id, draft.id)
    await isolateSweep(draft.id)
    await runAnnouncementDispatchSweep(prisma)
    const [recipient] = await prisma.announcementRecipient.findMany({ where: { announcementId: draft.id } })
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: recipient!.eventKey } })
    await prisma.notificationOutbox.update({ where: { id: outbox.id }, data: { status: 'failed' } })
    await prisma.announcementRecipient.update({ where: { id: recipient!.id }, data: { retryRequestedAt: new Date() } })

    let release!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM notification_outbox WHERE id = ${outbox.id} FOR UPDATE`
        await released
      },
      { timeout: 15_000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 200))
    const started = Date.now()
    await expect(runAnnouncementDispatchSweep(prisma)).rejects.toBeTruthy()
    expect(Date.now() - started).toBeLessThan(4_000)
    release()
    await holder

    await expect(runAnnouncementDispatchSweep(prisma)).resolves.toMatchObject({ requeued: 1 })
    expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: outbox.id } })).toMatchObject({
      status: 'pending',
      generation: 1,
    })
  }, 30_000)
})

describe('bulk retry', () => {
  it('flags only final, certain failures once and requeues them within capacity', async () => {
    const admin = await seedAdmin()
    const tag = `retry-${randomUUID().slice(0, 8)}`
    const sellers = []
    for (let index = 0; index < 5; index += 1) sellers.push(await seedSeller({ tag, name: `r${index}` }))
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    await sendDraft(admin.id, draft.id)
    await isolateSweep(draft.id)
    await runAnnouncementDispatchSweep(prisma)

    const recipients = await prisma.announcementRecipient.findMany({
      where: { announcementId: draft.id },
      orderBy: { sellerName: 'asc' },
    })
    // Final failures for all five; r3's SMTP outcome is uncertain; r4's seller is deleted.
    for (const [index, recipient] of recipients.entries()) {
      await prisma.notificationOutbox.updateMany({ where: { eventKey: recipient.eventKey }, data: { status: 'failed' } })
      await prisma.notificationDelivery.create({
        data: {
          eventKey: recipient.eventKey,
          userId: recipient.userId,
          type: 'seller_announcement',
          channel: 'email',
          recipient: `${recipient.userId}@example.test`,
          status: 'failed',
          transportStatus: index === 3 ? 'uncertain' : 'unknown',
          lastError: 'SEND_FAILED:EENVELOPE:550',
        },
      })
    }
    await createAdminSellerManagementService(prisma).deleteSeller({ sellerId: sellers[4]!.id, adminActorId: admin.id })

    const preview = await service().retryPreview(draft.id)
    expect(preview.eligible.map((row) => row.sellerName)).toEqual(recipients.slice(0, 3).map((r) => r.sellerName))

    const reason = 'Resend geçici hatası giderildi'
    const attempts = await Promise.allSettled([
      service().retryFailed(admin.id, draft.id, { reason, eligibleHash: preview.eligibleHash }),
      service().retryFailed(admin.id, draft.id, { reason, eligibleHash: preview.eligibleHash }),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.announcementRecipient.count({ where: { announcementId: draft.id, retryRequestedAt: { not: null } } })).toBe(3)
    // Nothing is requeued by the request itself.
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: `announcement:${draft.id}:` }, status: 'pending' } })).toBe(0)

    // Only one free slot: exactly one retry is requeued now.
    await isolateSweep(draft.id)
    await fillBulkLane(99)
    await expect(runAnnouncementDispatchSweep(prisma)).resolves.toMatchObject({ requeued: 1 })
    expect(await prisma.announcementRecipient.count({ where: { announcementId: draft.id, retryRequestedAt: { not: null } } })).toBe(2)

    // A retry that became uncertain meanwhile is cleared without a requeue.
    await prisma.announcementRecipient.update({ where: { id: recipients[3]!.id }, data: { retryRequestedAt: new Date() } })
    await drainBulkLane({ fillersOnly: true })
    await expect(runAnnouncementDispatchSweep(prisma)).resolves.toMatchObject({ requeued: 2, cleared: 1 })

    const outboxRows = await prisma.notificationOutbox.findMany({
      where: { eventKey: { in: recipients.map((r) => r.eventKey) } },
      orderBy: { eventKey: 'asc' },
    })
    const byKey = new Map(outboxRows.map((row) => [row.eventKey, row]))
    for (const recipient of recipients.slice(0, 3)) {
      expect(byKey.get(recipient.eventKey)).toMatchObject({ status: 'pending', generation: 1 })
      expect(
        await prisma.notificationDelivery.findFirstOrThrow({ where: { eventKey: recipient.eventKey } }),
      ).toMatchObject({ status: 'pending', lastError: null })
    }
    expect(byKey.get(recipients[3]!.eventKey)).toMatchObject({ status: 'failed', generation: 0 })
    expect(
      await prisma.adminAuditLog.count({ where: { targetId: draft.id, actionType: 'announcement_retry_requested' } }),
    ).toBe(1)
  }, 30_000)
})

describe('after sending', () => {
  it('keeps the frozen history when a recipient seller is hard-deleted', async () => {
    const admin = await seedAdmin()
    const tag = `del-${randomUUID().slice(0, 8)}`
    const kept = await seedSeller({ tag, name: 'a' })
    const removed = await seedSeller({ tag, name: 'b' })
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    await sendDraft(admin.id, draft.id)

    await createAdminSellerManagementService(prisma).deleteSeller({ sellerId: removed.id, adminActorId: admin.id })

    const rows = await prisma.announcementRecipient.findMany({ where: { announcementId: draft.id } })
    expect(rows).toHaveLength(2)
    const deletedRow = rows.find((row) => row.sellerId === null)!
    expect(deletedRow.sellerDeletedAt).toBeInstanceOf(Date)
    expect(deletedRow.sellerName).toBe(`${tag} b`)
    expect(rows.some((row) => row.sellerId === kept.id)).toBe(true)

    const progress = await service().progress(draft.id)
    expect(progress.counts.seller_deleted).toBe(1)
    expect(progress.total).toBe(2)
    expect(progress.recipientCount).toBe(2)
  })

  it('edits the panel copy only; the dispatcher still sends the frozen content', async () => {
    const admin = await seedAdmin()
    const tag = `edit-${randomUUID().slice(0, 8)}`
    await seedSeller({ tag })
    const draft = await seedDraft(admin.id, audience({ filters: { nameQuery: tag } }))
    await sendDraft(admin.id, draft.id)
    await isolateSweep(draft.id)
    await runAnnouncementDispatchSweep(prisma)
    const before = await prisma.notificationOutbox.count()

    const sent = await prisma.announcement.findUniqueOrThrow({ where: { id: draft.id } })
    await service().updateAfterSend(admin.id, draft.id, {
      version: sent.version,
      title: 'Düzeltilmiş başlık',
      body: 'Düzeltilmiş metin',
    })
    const edited = await prisma.announcement.findUniqueOrThrow({ where: { id: draft.id } })
    expect(edited).toMatchObject({
      title: 'Düzeltilmiş başlık',
      sentTitle: 'Kargo kuralı değişti',
      sentBody: 'Yeni kargo kuralı 1 Ekim itibarıyla geçerlidir.',
    })
    expect(edited.editedAfterSendAt).toBeInstanceOf(Date)
    expect(await prisma.notificationOutbox.count()).toBe(before)

    const outbox = await prisma.notificationOutbox.findFirstOrThrow({
      where: { eventKey: { startsWith: `announcement:${draft.id}:` } },
    })
    await processNotificationDispatch({
      id: 'job-1',
      data: { ...(outbox.payload as object), outboxId: outbox.id, generation: outbox.generation },
    } as never)
    expect(h.send).toHaveBeenCalledOnce()
    const email = h.send.mock.calls[0]![0] as { subject: string; text: string; fromCategory: string }
    expect(email.subject).toBe('Hanuja Duyurusu: Kargo kuralı değişti')
    expect(email.text).toContain('Yeni kargo kuralı 1 Ekim itibarıyla geçerlidir.')
    expect(email.text).not.toContain('Düzeltilmiş')
    expect(email.fromCategory).toBe('noreply')
    // The seller also gets an in-app notification pointing at the announcement.
    expect(
      await prisma.notification.count({ where: { type: 'seller_announcement', title: 'Yeni duyuru' } }),
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('media attach vs delete', () => {
  it('never leaves an announcement attached to media whose file was removed', async () => {
    const admin = await seedAdmin()
    const media = createMediaService({ prisma })
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const key = `announcements/${admin.id}/${randomUUID()}.png`
      const asset = await prisma.mediaAsset.create({
        data: {
          type: 'product_image',
          kind: 'image',
          url: `https://media.hanuja.tr/${key}`,
          key,
          folder: 'announcements',
          status: 'ready',
          uploadedBy: admin.id,
        },
      })
      const draft = await seedDraft(admin.id, audience())
      await Promise.allSettled([
        service().updateDraft(draft.id, {
          version: draft.version,
          title: draft.title,
          body: draft.body,
          mediaAssetId: asset.id,
          posterAssetId: null,
          audience: audience(),
        }),
        media.deleteAsset(asset.id, admin.id),
      ])

      const after = await prisma.announcement.findUniqueOrThrow({ where: { id: draft.id } })
      const assetStillThere = await prisma.mediaAsset.count({ where: { id: asset.id } })
      if (after.mediaAssetId === asset.id) {
        expect(assetStillThere).toBe(1)
        expect(h.deletedKeys).not.toContain(key)
      } else {
        expect(after.mediaAssetId).toBeNull()
        expect(assetStillThere).toBe(0)
        expect(h.deletedKeys).toContain(key)
      }
    }
  }, 60_000)
})
