import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { getMarketingChannelStatus, releaseBlockedMarketingReservation, updateMarketingChannel } from '../../api/services/marketing-channel.service'
import { runCampaignSendGate } from '../../api/services/campaign-send-gate'

const url = new URL(process.env.NOTIFICATION_TEST_DATABASE_URL ?? 'http://invalid')
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/hanuja_notification_test')
  throw new Error('Requires disposable local hanuja_notification_test database')
const schema = `marketing_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } })
beforeAll(async () => {
  execFileSync(process.execPath, [resolve('../db/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve('../db/schema/schema.prisma')], { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' })
}, 120000)
afterAll(async () => {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})
describe('marketing migration and real database gate', () => {
  it('defaults both channels to closed and disallows readiness overrides', async () => {
    expect(await prisma.marketingChannelSettings.findUnique({ where: { id: 'marketing' } })).toMatchObject({ emailEnabled: false, smsEnabled: false })
    await prisma.marketingChannelSettings.update({ where: { id: 'marketing' }, data: { emailEnabled: true, smsEnabled: true } })
    expect((await getMarketingChannelStatus(prisma, 'email')).reason).toBe('IYS_NOT_CONFIGURED')
    expect((await getMarketingChannelStatus(prisma, 'sms')).reason).toBe('SMS_PROVIDER_NOT_CONFIGURED')
    await releaseBlockedMarketingReservation(prisma, 'nonexistent-test-event', 'disabled')
    await prisma.marketingChannelSettings.delete({ where: { id: 'marketing' } })
    expect((await getMarketingChannelStatus(prisma, 'email')).reason).toBe('MARKETING_SETTINGS_UNAVAILABLE')
  })

  it('cannot enable delivery and releases only unattempted reservations when disabled', async () => {
    await prisma.marketingChannelSettings.create({ data: { id: 'marketing' } })
    const user = await prisma.user.create({ data: { email: `closed-${randomUUID()}@example.test`, role: 'customer' } })
    const reservedKey = `closed-${randomUUID()}`
    const uncertainKey = `uncertain-${randomUUID()}`
    await prisma.campaignEmailDispatch.createMany({ data: [
      { userId: user.id, source: 'cart', productId: 'closed-product', discountFingerprint: randomUUID(), eventKey: reservedKey, status: 'reserved' },
      { userId: user.id, source: 'cart', productId: 'uncertain-product', discountFingerprint: randomUUID(), eventKey: uncertainKey, status: 'uncertain', sendingAt: new Date() },
    ] })
    const settings = await prisma.marketingChannelSettings.findUniqueOrThrow({ where: { id: 'marketing' } })
    await expect(updateMarketingChannel(prisma, { channel: 'email', enabled: true, actorId: 'test-admin', version: settings.version })).rejects.toThrow()
    expect((await prisma.marketingChannelSettings.findUniqueOrThrow({ where: { id: 'marketing' } })).version).toBe(settings.version)
    expect(await runCampaignSendGate(prisma, { type: 'product_discount_in_cart', eventKey: reservedKey, userId: user.id, emailTo: user.email }))
      .toEqual({ proceed: false, reason: 'MARKETING_CHANNEL_DISABLED' })
    expect(await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey: reservedKey } }))
      .toMatchObject({ status: 'released', releaseReason: 'MARKETING_CHANNEL_DISABLED' })
    expect((await prisma.campaignEmailDispatch.findUniqueOrThrow({ where: { eventKey: uncertainKey } })).status).toBe('uncertain')
  })
})
