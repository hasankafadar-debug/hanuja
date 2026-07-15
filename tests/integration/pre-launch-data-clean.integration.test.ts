import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { performCleanup } from '../../tools/scripts/pre-launch-data-clean'

const databaseUrl = process.env['CLEANUP_TEST_DATABASE_URL']
const run = databaseUrl ? describe : describe.skip

run('pre-launch cleanup fixture (dedicated database)', () => {
  let prisma: PrismaClient
  beforeAll(async () => {
    const { PrismaClient: RealPrismaClient } = await import('../../node_modules/.prisma/client/index.js')
    prisma = new RealPrismaClient({ datasourceUrl: databaseUrl })
    await prisma.user.create({ data: { id: 'cleanup-admin', email: 'cleanup-admin@example.test', role: 'admin', accounts: { create: { id: 'cleanup-admin-account', accountId: 'cleanup-admin@example.test', providerId: 'credential', password: 'preserved-hash' } } } })
    await prisma.user.create({ data: { id: 'cleanup-customer', email: 'cleanup-customer@example.test', role: 'customer', accounts: { create: { id: 'cleanup-customer-account', accountId: 'cleanup-customer@example.test', providerId: 'credential', password: 'delete-me' } } } })
    await prisma.user.create({ data: { id: 'cleanup-seller-user', email: 'cleanup-seller@example.test', role: 'seller', seller: { create: { id: 'cleanup-seller', slug: 'cleanup-seller', displayName: 'Cleanup Seller' } } } })
  })
  afterAll(async () => {
    await prisma.account.deleteMany({ where: { userId: { in: ['cleanup-admin', 'cleanup-customer'] } } })
    await prisma.user.deleteMany({ where: { id: { in: ['cleanup-admin', 'cleanup-customer'] } } })
    await prisma.$disconnect()
  })
  it('deletes seller data and preserves customer data plus the admin credential hash', async () => {
    await performCleanup(prisma, {
      sellerIds: ['cleanup-seller'],
      sellers: 1,
      products: 0,
      orders: 0,
    })
    expect(await prisma.seller.count()).toBe(0)
    expect(await prisma.user.count({ where: { id: 'cleanup-seller-user' } })).toBe(0)
    expect(await prisma.user.count({ where: { id: 'cleanup-customer', role: 'customer' } })).toBe(1)
    expect(await prisma.account.findFirst({ where: { userId: 'cleanup-customer' } })).not.toBeNull()
    const admin = await prisma.account.findFirst({ where: { userId: 'cleanup-admin', providerId: 'credential' } })
    expect(admin?.password).toBe('preserved-hash')
  })
})
