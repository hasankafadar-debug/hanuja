import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { getMarketingChannelStatus, releaseBlockedMarketingReservation } from '../../api/services/marketing-channel.service'

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
})
