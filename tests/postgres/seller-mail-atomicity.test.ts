import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { createAdminSellerActivationService } from '../../api/services/admin-seller-activation.service'
import { createSellerBankService } from '../../api/services/seller-bank.service'

// An operational mail must be queued without calling SMTP or Redis from its transaction.
vi.mock('../../api/lib/mailer', () => ({
  sendEmail: () => {
    throw new Error('SMTP must not be contacted by the business operation')
  },
}))
const testUrl = process.env.NOTIFICATION_TEST_DATABASE_URL
if (!testUrl)
  throw new Error(
    'NOTIFICATION_TEST_DATABASE_URL must point to disposable local hanuja_notification_test',
  )
const url = new URL(testUrl)
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/hanuja_notification_test'
)
  throw new Error('Refusing non-local notification test database')
const schema = `notification_test_${randomUUID().replaceAll('-', '')}`
url.searchParams.set('schema', schema)
const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
})
beforeAll(async () => {
  execFileSync(
    process.execPath,
    [
      resolve('../db/node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      resolve('../db/schema/schema.prisma'),
    ],
    {
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    },
  )
  await prisma.$connect()
})
afterAll(async () => {
  if (!/^notification_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Unsafe test schema')
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await prisma.$disconnect()
})

async function sellerFixture() {
  const user = await prisma.user.create({
    data: { email: randomUUID() + '@example.test', role: 'seller' },
  })
  const admin = await prisma.user.create({
    data: { email: randomUUID() + '@example.test', role: 'admin' },
  })
  const seller = await prisma.seller.create({
    data: { userId: user.id, slug: randomUUID(), displayName: '<Demo>', status: 'active' },
  })
  return { user, admin, seller }
}

function withBrokenOutbox() {
  return new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction')
        return (callback: (tx: unknown) => unknown) =>
          prisma.$transaction(async (tx) => {
            const failingTx = new Proxy(tx, {
              get(client, property) {
                if (property === 'notificationOutbox')
                  return {
                    upsert: async () => {
                      throw new Error('OUTBOX_UNAVAILABLE')
                    },
                  }
                return Reflect.get(client, property)
              },
            })
            return callback(failingTx)
          })
      return Reflect.get(target, key)
    },
  })
}

describe('seller operational mail atomicity against PostgreSQL', () => {
  const iban = 'TR330006100519786457841326'
  it('commits bank intent, history, audit and one masked mail together without SMTP', async () => {
    const { user, seller } = await sellerFixture()
    const detail = await createSellerBankService({ prisma }).requestChange({
      sellerId: seller.id,
      actorId: user.id,
      iban,
      accountHolder: 'Demo',
      bankName: 'Demo Bank',
    })
    const outbox = await prisma.notificationOutbox.findFirstOrThrow({ where: { userId: user.id } })
    expect(outbox.type).toBe('seller_bank_detail_pending')
    expect(JSON.stringify(outbox.payload)).not.toContain(iban)
    expect(await prisma.sellerBankDetailHistory.count({ where: { bankDetailId: detail.id } })).toBe(
      1,
    )
    expect(await prisma.adminAuditLog.count({ where: { targetId: detail.id } })).toBe(1)
  })
  it('rolls back the bank change, audit and history when outbox persistence fails', async () => {
    const { user, seller } = await sellerFixture()
    await expect(
      createSellerBankService({ prisma: withBrokenOutbox() }).requestChange({
        sellerId: seller.id,
        actorId: user.id,
        iban,
        accountHolder: 'Demo',
        bankName: 'Demo Bank',
      }),
    ).rejects.toThrow('OUTBOX_UNAVAILABLE')
    expect(await prisma.sellerBankDetail.count({ where: { sellerId: seller.id } })).toBe(0)
    expect(await prisma.sellerBankDetailHistory.count({ where: { sellerId: seller.id } })).toBe(0)
    expect(await prisma.adminAuditLog.count({ where: { actorId: user.id } })).toBe(0)
  })
  it('deduplicates approval mail even when the admin repeats the operation', async () => {
    const { user, admin, seller } = await sellerFixture()
    const detail = await prisma.sellerBankDetail.create({
      data: { sellerId: seller.id, iban, accountHolder: 'Demo', bankName: 'Demo Bank' },
    })
    const service = createSellerBankService({ prisma })
    await service.approvePending({ bankDetailId: detail.id, adminActorId: admin.id })
    await service.approvePending({ bankDetailId: detail.id, adminActorId: admin.id })
    expect(
      await prisma.notificationOutbox.count({
        where: { userId: user.id, type: 'seller_bank_detail_approved' },
      }),
    ).toBe(1)
  })
  it('rolls back initial seller activation when its approval mail cannot be persisted', async () => {
    const { admin, seller } = await sellerFixture()
    await prisma.seller.update({
      where: { id: seller.id },
      data: { status: 'pending', requiredDocumentTypes: ['tax_certificate'] },
    })
    await prisma.sellerProfile.create({ data: { sellerId: seller.id } })
    await prisma.sellerDocument.create({
      data: {
        sellerId: seller.id,
        type: 'tax_certificate',
        status: 'approved',
        fileUrl: 'private',
        fileKey: 'test',
        fileName: 'test.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      },
    })
    const bank = await prisma.sellerBankDetail.create({
      data: { sellerId: seller.id, iban, accountHolder: 'Demo', bankName: 'Demo Bank' },
    })
    await expect(
      createAdminSellerActivationService({ prisma: withBrokenOutbox() }).activateInitial({
        sellerId: seller.id,
        adminActorId: admin.id,
      }),
    ).rejects.toThrow('OUTBOX_UNAVAILABLE')
    expect((await prisma.seller.findUniqueOrThrow({ where: { id: seller.id } })).status).toBe(
      'pending',
    )
    expect(
      (await prisma.sellerBankDetail.findUniqueOrThrow({ where: { id: bank.id } })).status,
    ).toBe('PENDING_ACTIVATION')
    expect(
      (await prisma.sellerProfile.findUniqueOrThrow({ where: { sellerId: seller.id } })).isVerified,
    ).toBe(false)
  })
  it('rolls back admin verification and history when its mail cannot be persisted', async () => {
    const { admin, seller } = await sellerFixture()
    const detail = await prisma.sellerBankDetail.create({
      data: { sellerId: seller.id, iban, accountHolder: 'Demo', bankName: 'Demo Bank' },
    })
    await expect(
      createSellerBankService({ prisma: withBrokenOutbox() }).approvePending({
        bankDetailId: detail.id,
        adminActorId: admin.id,
      }),
    ).rejects.toThrow('OUTBOX_UNAVAILABLE')
    expect(
      (await prisma.sellerBankDetail.findUniqueOrThrow({ where: { id: detail.id } })).isVerified,
    ).toBe(false)
    expect(await prisma.sellerBankDetailHistory.count({ where: { bankDetailId: detail.id } })).toBe(
      0,
    )
  })
})
