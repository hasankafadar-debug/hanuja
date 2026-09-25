/** Customer campaign persistence, locks and send decisions against disposable PostgreSQL. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

// Production readiness is deliberately closed until IYS is integrated. Only this
// hypothetical open-channel pipeline test overrides readiness; the real closed
// module is exercised by marketing-channel-control.test.ts.
vi.mock('../../api/services/marketing-channel.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/services/marketing-channel.service')>()),
  getMarketingChannelStatus: vi.fn(async () => ({ channel: 'email', canSend: true, reason: null })),
  assertMarketingChannelOpen: vi.fn(async () => undefined),
}))

import { createCustomerCampaignService, customerCampaignEventKey, loadSubmittedCustomerCampaign, runCustomerCampaignDispatchSweep } from '../../api/services/customer-campaign.service'
import { runCampaignSendGate } from '../../api/services/campaign-send-gate'
import { expireStaleCampaignReservations, markCampaignReservation, reserveCampaignEmail } from '../../api/services/campaign-email-reservation'
import { createMarketingConsentService } from '../../api/services/marketing-consent.service'

const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl) throw new Error('NOTIFICATION_TEST_DATABASE_URL must target disposable local hanuja_notification_test')
const url = new URL(testUrl)
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Refusing non-local notification test database')
const schema = `customer_campaign_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
url.searchParams.set('connection_limit', '12')
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
const service = createCustomerCampaignService({ prisma })
const DAY = 86_400_000

beforeAll(async () => {
  execFileSync(process.execPath,
    [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' })
  await prisma.$connect()
}, 120_000)

afterAll(async () => {
  if (!/^customer_campaign_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

async function user(role: 'customer' | 'admin' = 'customer', consent = true) {
  const suffix = randomUUID().slice(0, 12)
  const row = await prisma.user.create({ data: { email: `campaign-${suffix}@example.test`, role, name: suffix } })
  if (consent) {
    await prisma.marketingConsentAddress.create({ data: {
      userId: row.id, channel: 'email', address: row.email, status: 'granted',
      grantedAt: new Date(), verifiedIysAt: new Date(), textVersion: 'test-v1',
      optOutToken: randomUUID(),
    } })
  }
  return row
}

async function campaign(actorId: string, userIds: string[], body = 'Frozen campaign body') {
  const draft = await service.createDraft(actorId, 'email')
  const saved = await service.updateDraft(actorId, draft.id, {
    version: 1, title: 'Customer campaign', body, ctaLabel: null, ctaUrl: null,
    mediaAssetId: null, posterAssetId: null,
    audience: { mode: 'manual', manualUserIds: userIds, excludedUserIds: [], filters: {} },
  })
  const preview = await service.previewRecipients(draft.id)
  return { id: draft.id, version: saved.version, preview }
}

async function submitted(actorId: string, userIds: string[]) {
  const draft = await campaign(actorId, userIds)
  await service.submit(actorId, draft.id, { version: draft.version, audienceHash: draft.preview.audienceHash })
  return draft.id
}

describe('customer campaign PostgreSQL pipeline', () => {
  it('freezes audience/content once and concurrent sweeps write one reservation and outbox per recipient', async () => {
    const admin = await user('admin')
    const first = await user()
    const second = await user()
    const excludedRole = await user('admin')
    const draft = await campaign(admin.id, [first.id, second.id, excludedRole.id])
    expect(draft.preview.count).toBe(2)
    await expect(service.submit(admin.id, draft.id, { version: draft.version, audienceHash: 'stale' })).rejects.toThrow()
    expect(await prisma.customerCampaignRecipient.count({ where: { campaignId: draft.id } })).toBe(0)
    expect(await service.submit(admin.id, draft.id, { version: draft.version, audienceHash: draft.preview.audienceHash }))
      .toEqual({ recipientCount: 2 })
    await expect(service.submit(admin.id, draft.id, { version: draft.version, audienceHash: draft.preview.audienceHash })).rejects.toThrow()
    await expect(service.updateDraft(admin.id, draft.id, {
      version: draft.version + 1, title: 'Changed', body: 'Changed', ctaLabel: null, ctaUrl: null,
      mediaAssetId: null, posterAssetId: null,
      audience: { mode: 'all', manualUserIds: [], excludedUserIds: [], filters: {} },
    })).rejects.toThrow()
    expect((await loadSubmittedCustomerCampaign(prisma, draft.id,
      (await prisma.customerCampaignRecipient.findFirstOrThrow({ where: { campaignId: draft.id, userId: first.id } })).id,
      first.id)).content.body).toBe('Frozen campaign body')

    await Promise.all([runCustomerCampaignDispatchSweep(prisma), runCustomerCampaignDispatchSweep(prisma)])
    const rows = await prisma.customerCampaignRecipient.findMany({ where: { campaignId: draft.id } })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.status === 'queued')).toBe(true)
    expect(await prisma.campaignEmailDispatch.count({ where: { source: 'customer_campaign', eventKey: { in: rows.map((row) => row.eventKey) } } })).toBe(2)
    expect(await prisma.notificationOutbox.count({ where: { type: 'customer_campaign', eventKey: { in: rows.map((row) => row.eventKey) } } })).toBe(2)
    await runCustomerCampaignDispatchSweep(prisma)
    expect(await prisma.notificationOutbox.count({ where: { type: 'customer_campaign', eventKey: { in: rows.map((row) => row.eventKey) } } })).toBe(2)
  }, 30_000)

  it('serializes admin and cart sends under the same rolling 24h cap; failed sends retry but uncertainty counts', async () => {
    const admin = await user('admin')
    const recipient = await user()
    const now = new Date()
    await prisma.campaignEmailDispatch.createMany({ data: [
      { userId: recipient.id, productId: 'prior-favorite', source: 'favorite', discountFingerprint: randomUUID(), status: 'sent', sentAt: new Date(now.getTime() - 60_000) },
      { userId: recipient.id, productId: 'prior-cart', source: 'cart', discountFingerprint: randomUUID(), status: 'sent', sentAt: new Date(now.getTime() - 120_000) },
      { userId: recipient.id, productId: 'yesterday', source: 'cart', discountFingerprint: randomUUID(), status: 'sent', sentAt: new Date(now.getTime() - DAY - 60_000) },
    ] })
    const campaignId = await submitted(admin.id, [recipient.id])
    await runCustomerCampaignDispatchSweep(prisma)
    const adminKey = customerCampaignEventKey(campaignId, recipient.id)
    const cartKey = `campaign-cart:${randomUUID()}`
    const cart = await prisma.$transaction((tx) => reserveCampaignEmail(tx, {
      userId: recipient.id, productId: `cart-${randomUUID()}`, source: 'cart',
      fingerprint: randomUUID(), eventKey: cartKey, now,
    }))
    expect(cart.ok).toBe(true)
    const results = await Promise.all([
      runCampaignSendGate(prisma, { type: 'customer_campaign', eventKey: adminKey, userId: recipient.id, emailTo: recipient.email, now }),
      runCampaignSendGate(prisma, { type: 'product_discount_in_cart', eventKey: cartKey, userId: recipient.id, emailTo: recipient.email, now }),
    ])
    expect(results.filter((result) => result.proceed)).toHaveLength(1)
    expect(results.find((result) => !result.proceed)).toEqual({ proceed: false, reason: 'CAMPAIGN_RELEASED:daily_cap' })
    const sentKey = results[0].proceed ? adminKey : cartKey
    await markCampaignReservation(prisma, sentKey, 'failed', now)
    expect((await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey: sentKey } })).status).toBe('reserved')
    expect(await runCampaignSendGate(prisma, { type: sentKey === adminKey ? 'customer_campaign' : 'product_discount_in_cart', eventKey: sentKey, userId: recipient.id, emailTo: recipient.email, now })).toEqual({ proceed: true })
    await markCampaignReservation(prisma, sentKey, 'uncertain', now)
    expect((await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey: sentKey } })).status).toBe('uncertain')
    expect(await runCampaignSendGate(prisma, { type: sentKey === adminKey ? 'customer_campaign' : 'product_discount_in_cart', eventKey: sentKey, userId: recipient.id, emailTo: recipient.email, now })).toEqual({ proceed: true })
    const later = await prisma.$transaction((tx) => reserveCampaignEmail(tx, {
      userId: recipient.id, productId: `later-${randomUUID()}`, source: 'cart',
      fingerprint: randomUUID(), eventKey: `later-${randomUUID()}`, now,
    }))
    expect(later).toEqual({ ok: false, reason: 'daily_cap' })
  }, 30_000)

  it('requeues only definite delivery failures, never an uncertain outcome', async () => {
    const admin = await user('admin')
    const failedUser = await user()
    const uncertainUser = await user()
    const campaignId = await submitted(admin.id, [failedUser.id, uncertainUser.id])
    await runCustomerCampaignDispatchSweep(prisma)
    const version = (await prisma.customerCampaign.findUniqueOrThrow({ where: { id: campaignId } })).version
    for (const [recipient, transportStatus] of [[failedUser, 'unknown'], [uncertainUser, 'uncertain']] as const) {
      const eventKey = customerCampaignEventKey(campaignId, recipient.id)
      await prisma.notificationOutbox.updateMany({ where: { eventKey }, data: { status: 'failed', lastError: 'provider failed' } })
      await prisma.notificationDelivery.create({ data: {
        eventKey, userId: recipient.id, type: 'customer_campaign', channel: 'email',
        recipient: recipient.email, status: 'failed', transportStatus, lastError: 'provider failed',
      } })
    }
    await expect(service.retryFailed(admin.id, campaignId, version - 1)).rejects.toThrow()
    expect(await service.retryFailed(admin.id, campaignId, version)).toEqual({ requeued: 1 })
    const definiteKey = customerCampaignEventKey(campaignId, failedUser.id)
    const uncertainKey = customerCampaignEventKey(campaignId, uncertainUser.id)
    expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: definiteKey } }))
      .toMatchObject({ status: 'pending', generation: 1 })
    expect(await prisma.notificationDelivery.findFirstOrThrow({ where: { eventKey: definiteKey } }))
      .toMatchObject({ status: 'pending', transportStatus: 'unknown' })
    expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: uncertainKey } }))
      .toMatchObject({ status: 'failed', generation: 0 })
    expect(await prisma.notificationDelivery.findFirstOrThrow({ where: { eventKey: uncertainKey } }))
      .toMatchObject({ status: 'failed', transportStatus: 'uncertain' })
    expect(await service.retryFailed(admin.id, campaignId, version)).toEqual({ requeued: 0 })
  })

  it('expires pending campaigns at 24h and releases stale reservations', async () => {
    const admin = await user('admin')
    const recipient = await user()
    const campaignId = await submitted(admin.id, [recipient.id])
    const eventKey = customerCampaignEventKey(campaignId, recipient.id)
    await prisma.customerCampaignRecipient.update({ where: { eventKey }, data: { submittedAt: new Date(Date.now() - DAY - 60_000) } })
    await runCustomerCampaignDispatchSweep(prisma)
    expect(await prisma.customerCampaignRecipient.findUniqueOrThrow({ where: { eventKey } }))
      .toMatchObject({ status: 'skipped', statusReason: 'CAMPAIGN_EXPIRED' })
    expect(await prisma.notificationOutbox.count({ where: { eventKey } })).toBe(0)
    const reservation = await prisma.campaignEmailDispatch.create({ data: {
      userId: recipient.id, source: 'customer_campaign', discountFingerprint: eventKey,
      eventKey, status: 'reserved', createdAt: new Date(Date.now() - DAY - 60_000),
    } })
    expect(await expireStaleCampaignReservations(prisma)).toBeGreaterThanOrEqual(1)
    expect(await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { id: reservation.id } }))
      .toMatchObject({ status: 'released', releaseReason: 'expired' })

    const queuedCampaignId = await submitted(admin.id, [recipient.id])
    await runCustomerCampaignDispatchSweep(prisma)
    const queuedKey = customerCampaignEventKey(queuedCampaignId, recipient.id)
    await prisma.customerCampaignRecipient.update({ where: { eventKey: queuedKey }, data: { submittedAt: new Date(Date.now() - DAY - 60_000) } })
    expect(await runCampaignSendGate(prisma, { type: 'customer_campaign', eventKey: queuedKey, userId: recipient.id, emailTo: recipient.email }))
      .toEqual({ proceed: false, reason: 'CAMPAIGN_EXPIRED' })
    expect(await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey: queuedKey } }))
      .toMatchObject({ status: 'released', releaseReason: 'CAMPAIGN_EXPIRED' })
  })

  it('checks the current address after reservation and preserves a revoke event', async () => {
    const admin = await user('admin')
    const recipient = await user()
    const campaignId = await submitted(admin.id, [recipient.id])
    await runCustomerCampaignDispatchSweep(prisma)
    const eventKey = customerCampaignEventKey(campaignId, recipient.id)
    const consent = createMarketingConsentService(prisma)
    expect(await consent.revokeByUser(recipient.id, 'email', 'account_settings')).toBe(true)
    expect(await consent.revokeByUser(recipient.id, 'email', 'account_settings')).toBe(false)
    const events = await prisma.marketingConsentEvent.findMany({ where: { userId: recipient.id, action: 'revoke' } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ address: recipient.email, source: 'account_settings', textVersion: 'test-v1' })
    await expect(prisma.marketingConsentEvent.update({ where: { id: events[0]!.id }, data: { source: 'reply_email' } })).rejects.toThrow()
    expect(await runCampaignSendGate(prisma, { type: 'customer_campaign', eventKey, userId: recipient.id, emailTo: recipient.email }))
      .toEqual({ proceed: false, reason: 'CAMPAIGN_RELEASED:no_consent' })
    expect((await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey } })).status).toBe('released')
  })
})
