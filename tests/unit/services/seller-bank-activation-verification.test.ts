import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
}))

vi.mock('../../../api/lib/mailer', () => ({ sendEmail: sendEmailMock }))
vi.mock('../../../api/jobs/notification-dispatch.job', () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}))

import { createSellerBankService } from '../../../api/services/seller-bank.service'

function makeBankDetail(isVerified: boolean) {
  return {
    id: isVerified ? 'verified-bank' : 'unverified-bank',
    sellerId: 'seller-1',
    iban: 'TR330006100519786457841326',
    status: 'PENDING_ACTIVATION',
    isActive: false,
    isVerified,
    verifiedAt: isVerified ? new Date('2026-07-20T09:00:00Z') : null,
    verifiedBy: isVerified ? 'admin-1' : null,
    activatesAt: new Date('2026-07-20T10:00:00Z'),
    blockedAt: null,
    previousIbanMasked: null,
    seller: {
      displayName: 'Demo Mağaza',
      user: { id: 'user-1', email: 'seller@example.test', name: 'Demo Satıcı' },
    },
  }
}

function createPrismaMock(candidate: ReturnType<typeof makeBankDetail>) {
  const prisma = {
    sellerBankDetail: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.isVerified === true && !candidate.isVerified) return []
        if (where.verifiedAt && !candidate.verifiedAt) return []
        if (where.verifiedBy && !candidate.verifiedBy) return []
        return [candidate]
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    },
    sellerBankDetailHistory: {
      create: vi.fn().mockResolvedValue({}),
    },
    notification: {
      create: vi.fn().mockResolvedValue({}),
    },
    adminAuditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }

  return prisma
}

describe('bank activation worker verification gate', () => {
  beforeEach(() => {
    sendEmailMock.mockReset()
  })

  it('does not activate an elapsed pending bank detail without admin verification', async () => {
    const prisma = createPrismaMock(makeBankDetail(false))
    const service = createSellerBankService({ prisma: prisma as never })

    await expect(service.activateEligiblePending()).resolves.toBe(0)

    expect(prisma.sellerBankDetail.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isVerified: true }),
      }),
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.sellerBankDetail.update).not.toHaveBeenCalled()
  })

  it('activates an elapsed pending bank detail after admin verification', async () => {
    const prisma = createPrismaMock(makeBankDetail(true))
    const service = createSellerBankService({ prisma: prisma as never })

    await expect(service.activateEligiblePending()).resolves.toBe(1)

    expect(prisma.sellerBankDetail.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'verified-bank',
        isVerified: true,
        status: 'PENDING_ACTIVATION',
      }),
      data: expect.objectContaining({
        isActive: true,
        status: 'ACTIVE',
      }),
    })
  })
})

describe('bank change account-status gate', () => {
  it('rejects bank changes while the seller application is pending', async () => {
    const prisma = {
      seller: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'seller-1',
          userId: 'user-1',
          status: 'pending',
          bankDetails: [],
          user: { id: 'user-1', email: 'seller@example.test', name: 'Demo Satıcı' },
        }),
      },
      adminAuditLog: { create: vi.fn() },
      notification: { create: vi.fn() },
    }
    const service = createSellerBankService({ prisma: prisma as never })

    await expect(
      service.requestChange({
        sellerId: 'seller-1',
        actorId: 'user-1',
        iban: 'TR330006100519786457841326',
        accountHolder: 'Demo Satıcı',
        bankName: 'Demo Bank',
      }),
    ).rejects.toThrow('yalnızca aktif satıcı hesabında')
  })
})
