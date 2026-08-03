import { describe, expect, it, vi } from 'vitest'
import {
  createAdminSellerActivationService,
  getRequiredDocumentTypes,
} from '../../../api/services/admin-seller-activation.service'

function createSeller(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seller-1',
    userId: 'user-1',
    status: 'pending',
    requiredDocumentTypes: ['identity', 'tax_certificate', 'signature_circular'],
    user: { email: 'seller@example.test' },
    profile: { id: 'profile-1' },
    bankDetails: [{ id: 'pending-bank' }],
    documents: [
      { type: 'identity', identityPart: 'combined' },
      { type: 'tax_certificate', identityPart: null },
      { type: 'signature_circular', identityPart: null },
    ],
    ...overrides,
  }
}

function createPrismaMock(seller = createSeller()) {
  const prisma = {
    seller: {
      findUnique: vi.fn().mockResolvedValue(seller),
      update: vi.fn().mockResolvedValue({}),
    },
    sellerBankDetail: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'pending-bank',
        iban: 'TR330006100519786457841326',
        previousIbanMasked: null,
      }),
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sellerBankDetailHistory: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    sellerProfile: {
      update: vi.fn().mockResolvedValue({}),
    },
    user: {
      update: vi.fn().mockResolvedValue({}),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }

  return prisma
}

describe('admin seller onboarding activation', () => {
  it('normalizes the persisted dynamic required-document list', () => {
    expect(
      getRequiredDocumentTypes([
        'identity',
        'signature_circular',
        'identity',
        'not-a-document',
        null,
      ]),
    ).toEqual(['identity', 'signature_circular'])
    expect(getRequiredDocumentTypes(null)).toEqual([])
  })

  it('is ready when every admin-requested type is approved without a hidden bank-statement rule', async () => {
    const prisma = createPrismaMock()
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).resolves.toMatchObject({
      sellerId: 'seller-1',
      pendingBankDetailId: 'pending-bank',
    })
  })

  it('reports exactly the requested document types that are still missing', async () => {
    const prisma = createPrismaMock(
      createSeller({
        documents: [{ type: 'identity' }, { type: 'signature_circular' }],
      }),
    )
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).rejects.toMatchObject({
      statusCode: 422,
      details: { missingDocumentTypes: ['tax_certificate'] },
    })
  })

  it('accepts approved identity front and back as a complete identity document', async () => {
    const prisma = createPrismaMock(
      createSeller({
        documents: [
          { type: 'identity', identityPart: 'front' },
          { type: 'identity', identityPart: 'back' },
          { type: 'tax_certificate', identityPart: null },
          { type: 'signature_circular', identityPart: null },
        ],
      }),
    )
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).resolves.toMatchObject({
      sellerId: 'seller-1',
    })
  })

  it('keeps identity missing until both separately uploaded faces are approved', async () => {
    const prisma = createPrismaMock(
      createSeller({
        documents: [
          { type: 'identity', identityPart: 'front' },
          { type: 'tax_certificate', identityPart: null },
          { type: 'signature_circular', identityPart: null },
        ],
      }),
    )
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).rejects.toMatchObject({
      statusCode: 422,
      details: { missingDocumentTypes: ['identity'] },
    })
  })

  it('accepts a complete approved contract group when contract is requested', async () => {
    const prisma = createPrismaMock(
      createSeller({
        requiredDocumentTypes: ['identity', 'contract'],
        documents: [
          { type: 'identity', identityPart: 'combined' },
          {
            type: 'contract',
            identityPart: null,
            uploadGroupId: 'contract-group-1',
            uploadOrder: 0,
            uploadGroupSize: 2,
          },
          {
            type: 'contract',
            identityPart: null,
            uploadGroupId: 'contract-group-1',
            uploadOrder: 1,
            uploadGroupSize: 2,
          },
        ],
      }),
    )
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).resolves.toMatchObject({
      sellerId: 'seller-1',
    })
  })

  it('keeps a requested contract missing when its approved group is incomplete', async () => {
    const prisma = createPrismaMock(
      createSeller({
        requiredDocumentTypes: ['identity', 'contract'],
        documents: [
          { type: 'identity', identityPart: 'combined' },
          {
            type: 'contract',
            identityPart: null,
            uploadGroupId: 'contract-group-1',
            uploadOrder: 0,
            uploadGroupSize: 2,
          },
        ],
      }),
    )
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).rejects.toMatchObject({
      statusCode: 422,
      details: { missingDocumentTypes: ['contract'] },
    })
  })

  it('requires an explicit admin document request before activation', async () => {
    const prisma = createPrismaMock(createSeller({ requiredDocumentTypes: [] }))
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await expect(service.assertReady('seller-1')).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('atomically activates and verifies the initial bank, profile, and seller', async () => {
    const prisma = createPrismaMock()
    const service = createAdminSellerActivationService({
      prisma: prisma as never,
    })

    await service.activateInitial({
      sellerId: 'seller-1',
      adminActorId: 'admin-1',
    })

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.sellerBankDetail.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pending-bank',
        sellerId: 'seller-1',
        status: 'PENDING_ACTIVATION',
      },
      data: expect.objectContaining({
        status: 'ACTIVE',
        isActive: true,
        isVerified: true,
        verifiedBy: 'admin-1',
        verifiedAt: expect.any(Date),
        activatedAt: expect.any(Date),
      }),
    })
    expect(prisma.sellerProfile.update).toHaveBeenCalledWith({
      where: { sellerId: 'seller-1' },
      data: { isVerified: true, verifiedAt: expect.any(Date) },
    })
    expect(prisma.seller.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { status: 'active' },
    })
    expect(prisma.sellerBankDetailHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        bankDetailId: 'pending-bank',
        action: 'activated',
        actorId: 'admin-1',
        actorRole: 'admin',
      }),
    })
    expect(prisma.adminAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 'admin-1',
        actionType: 'seller_activated',
        targetId: 'seller-1',
      }),
    })
  })
})
