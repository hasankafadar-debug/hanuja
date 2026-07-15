import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteObjectMock, enqueueProductSyncMock } = vi.hoisted(() => ({
  deleteObjectMock: vi.fn(),
  enqueueProductSyncMock: vi.fn(),
}))

vi.mock('../../../api/lib/r2', () => ({ deleteObject: deleteObjectMock }))
vi.mock('../../../api/jobs/search-index-sync.job', () => ({
  enqueueProductSync: enqueueProductSyncMock,
}))

import { createAdminSellerManagementService } from '../../../api/services/admin-seller-management.service'

function buildCountModel(value = 0) {
  return { count: vi.fn().mockResolvedValue(value) }
}

describe('admin seller management', () => {
  beforeEach(() => {
    deleteObjectMock.mockReset()
    enqueueProductSyncMock.mockReset()
  })

  it('blocks permanent deletion when commercial history exists', async () => {
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-1',
          displayName: 'Demo Seller',
          status: 'active',
          user: { id: 'user-1', email: 'seller@example.test' },
          profile: null,
          documents: [],
          products: [],
        }),
      },
      orderLine: buildCountModel(1),
      payout: buildCountModel(),
      sellerLedgerEntry: buildCountModel(),
      sellerInvoice: buildCountModel(),
      orderSellerInvoice: buildCountModel(),
      penalty: buildCountModel(),
      shipment: buildCountModel(),
      fulfillmentRisk: buildCountModel(),
      orderEmailAlias: buildCountModel(),
      couponUsage: buildCountModel(),
    } as never

    const service = createAdminSellerManagementService(prisma)
    await expect(
      service.deleteSeller({ sellerId: 'seller-1', adminActorId: 'admin-1' }),
    ).rejects.toMatchObject({
      code: 'SELLER_HAS_COMMERCIAL_HISTORY',
      statusCode: 409,
      details: { blockingCounts: expect.objectContaining({ orderLines: 1 }) },
    })
  })

  it('reports zeroed commercial history for an eligible seller', async () => {
    const prisma = {
      orderLine: buildCountModel(),
      payout: buildCountModel(),
      sellerLedgerEntry: buildCountModel(),
      sellerInvoice: buildCountModel(),
      orderSellerInvoice: buildCountModel(),
      penalty: buildCountModel(),
      shipment: buildCountModel(),
      fulfillmentRisk: buildCountModel(),
      orderEmailAlias: buildCountModel(),
      couponUsage: buildCountModel(),
    } as never

    const service = createAdminSellerManagementService(prisma)
    await expect(service.getCommercialHistoryCounts('seller-1')).resolves.toEqual({
      orderLines: 0,
      payouts: 0,
      ledgerEntries: 0,
      sellerInvoices: 0,
      orderInvoices: 0,
      penalties: 0,
      shipments: 0,
      fulfillmentRisks: 0,
      orderEmailAliases: 0,
      couponUsages: 0,
    })
  })
})
