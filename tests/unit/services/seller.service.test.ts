import { beforeEach, describe, expect, it, vi } from 'vitest'

const { enqueueStoreSyncMock } = vi.hoisted(() => ({
  enqueueStoreSyncMock: vi.fn(),
}))

vi.mock('../../../api/jobs/search-index-sync.job', () => ({
  enqueueStoreSync: enqueueStoreSyncMock,
}))

import { createSellerService } from '../../../api/services/seller.service'

describe('seller.service updateProfile search sync', () => {
  beforeEach(() => {
    enqueueStoreSyncMock.mockReset()
    enqueueStoreSyncMock.mockResolvedValue(undefined)
  })

  it('enqueues store reindex when store name changes', async () => {
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-1',
          userId: 'user-1',
          displayName: 'Eski Magaza',
          bankDetails: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      sellerProfile: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as never

    const service = createSellerService({ prisma })
    await service.updateProfile('seller-1', 'user-1', { storeName: 'Yeni Magaza' })

    expect(enqueueStoreSyncMock).toHaveBeenCalledWith({ entityId: 'seller-1' })
  })

  it('does not enqueue store reindex when the store name is unchanged', async () => {
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-1',
          userId: 'user-1',
          displayName: 'Ayni Magaza',
          bankDetails: [],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      sellerProfile: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    } as never

    const service = createSellerService({ prisma })
    await service.updateProfile('seller-1', 'user-1', {
      storeName: 'Ayni Magaza',
      bio: 'Kisa aciklama',
    })

    expect(enqueueStoreSyncMock).not.toHaveBeenCalled()
  })
})

describe('seller.service updateVacationMode', () => {
  beforeEach(() => {
    enqueueStoreSyncMock.mockReset()
    enqueueStoreSyncMock.mockResolvedValue(undefined)
  })

  function createPrismaMock(productIds = [{ id: 'product-1' }, { id: 'product-2' }]) {
    const tx = {
      seller: { update: vi.fn().mockResolvedValue({}) },
      product: { findMany: vi.fn().mockResolvedValue(productIds) },
      cartItem: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
    }
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-1',
          userId: 'user-1',
          displayName: 'Magaza',
          bankDetails: [],
        }),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    }
    return { prisma: prisma as never, tx }
  }

  it('enables Tatil Modu, clears seller products from carts, and removes search documents', async () => {
    const { prisma, tx } = createPrismaMock()
    const service = createSellerService({ prisma })

    await expect(service.updateVacationMode('seller-1', 'user-1', true)).resolves.toBe(true)

    expect(tx.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { vacationModeEnabled: true },
    })
    expect(tx.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { productId: { in: ['product-1', 'product-2'] } },
    })
    expect(enqueueStoreSyncMock).toHaveBeenCalledWith({
      entityId: 'seller-1',
      operation: 'delete',
    })
  })

  it('disables Tatil Modu without touching carts and reindexes published products', async () => {
    const { prisma, tx } = createPrismaMock()
    const service = createSellerService({ prisma })

    await expect(service.updateVacationMode('seller-1', 'user-1', false)).resolves.toBe(false)

    expect(tx.product.findMany).not.toHaveBeenCalled()
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled()
    expect(enqueueStoreSyncMock).toHaveBeenCalledWith({
      entityId: 'seller-1',
      operation: 'upsert',
    })
  })
})
