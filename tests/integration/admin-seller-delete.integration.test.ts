import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'

const { enqueueProductSyncMock, deleteObjectMock } = vi.hoisted(() => ({
  enqueueProductSyncMock: vi.fn().mockResolvedValue(undefined),
  deleteObjectMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: enqueueProductSyncMock,
}))
vi.mock('../../api/lib/r2', () => ({ deleteObject: deleteObjectMock }))

import { createAdminSellerManagementService } from '../../api/services/admin-seller-management.service'

const databaseUrl = process.env['CLEANUP_TEST_DATABASE_URL']
const run = databaseUrl ? describe : describe.skip

run('admin seller delete (dedicated database)', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    const { PrismaClient: RealPrismaClient } = await import('../../node_modules/.prisma/client/index.js')
    prisma = new RealPrismaClient({ datasourceUrl: databaseUrl })
    await prisma.user.create({
      data: { id: 'seller-delete-admin', email: 'seller-delete-admin@example.test', role: 'admin' },
    })
    await prisma.user.create({
      data: {
        id: 'seller-delete-user',
        email: 'seller-delete@example.test',
        role: 'seller',
        seller: {
          create: {
            id: 'seller-delete-seller',
            slug: 'seller-delete-seller',
            displayName: 'Silinebilir Satıcı',
            products: {
              create: {
                id: 'seller-delete-product',
                slug: 'seller-delete-product',
                name: 'Silinebilir Ürün',
                price: 100,
              },
            },
          },
        },
      },
    })
  })

  afterAll(async () => {
    await prisma.adminAuditLog.deleteMany({
      where: { targetId: 'seller-delete-seller' },
    })
    await prisma.user.deleteMany({ where: { id: 'seller-delete-admin' } })
    await prisma.$disconnect()
  })

  it('deletes an eligible seller, user and product while preserving an audit record', async () => {
    const service = createAdminSellerManagementService(prisma)
    await expect(
      service.deleteSeller({
        sellerId: 'seller-delete-seller',
        adminActorId: 'seller-delete-admin',
      }),
    ).resolves.toMatchObject({ id: 'seller-delete-seller', failedMediaKeys: [] })

    expect(await prisma.seller.findUnique({ where: { id: 'seller-delete-seller' } })).toBeNull()
    expect(await prisma.product.findUnique({ where: { id: 'seller-delete-product' } })).toBeNull()
    expect(await prisma.user.findUnique({ where: { id: 'seller-delete-user' } })).toBeNull()
    expect(
      await prisma.adminAuditLog.findFirst({
        where: { targetId: 'seller-delete-seller', actionType: 'seller_deleted' },
      }),
    ).not.toBeNull()
  })
})
