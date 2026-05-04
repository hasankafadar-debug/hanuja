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
