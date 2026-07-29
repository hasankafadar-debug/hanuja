import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getSessionMock, prismaMock, transactionClient, verifyTurnstileMock } =
  vi.hoisted(() => {
    const transactionClient = {
      seller: { create: vi.fn() },
      sellerBankDetail: { create: vi.fn() },
      user: { update: vi.fn() },
      twoFactor: { upsert: vi.fn() },
    }
    return {
      getSessionMock: vi.fn(),
      verifyTurnstileMock: vi.fn(),
      transactionClient,
      prismaMock: {
        seller: { findUnique: vi.fn() },
        $transaction: vi.fn(
          async (callback: (tx: typeof transactionClient) => Promise<void>) =>
            callback(transactionClient),
        ),
      },
    }
  })

vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {
    constructor() {
      return prismaMock
    }
  },
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))
vi.mock('@hanuja/api/lib/csrf-check', () => ({
  checkCsrf: vi.fn(() => null),
}))
vi.mock('@hanuja/api/lib/turnstile', () => ({
  verifyTurnstileToken: verifyTurnstileMock,
}))
vi.mock('@hanuja/security', () => ({
  hasMatchingNormalizedTokens: vi.fn(() => true),
}))

import { POST } from '../../../apps/seller-panel/src/app/api/seller/onboarding/route'

function makeRequest() {
  return new NextRequest('http://seller.example/api/seller/onboarding', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      banka: {
        accountHolderName: 'Hanuja Test Limited',
        bankName: 'Test Bank',
        iban: 'TR120001234567890123456789',
      },
      isletme: {
        address: 'Test Mahallesi 1',
        city: 'İstanbul',
        companyName: 'Hanuja Test Limited',
        companyType: 'limited',
        district: 'Kadıköy',
        taxNumber: '1234567890',
        taxOffice: 'Kadıköy',
      },
      magaza: {
        city: 'İstanbul',
        description: 'Test mağaza açıklaması',
        slug: 'hanuja-test-magaza',
        storeName: 'Hanuja Test Mağaza',
      },
      phone: '05551234567',
      turnstileToken: 'verified-turnstile-token',
    }),
  })
}

describe('POST /api/seller/onboarding email OTP readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getSessionMock.mockResolvedValue({
      user: {
        id: 'seller-user-1',
        role: 'customer',
        emailVerified: true,
      },
    })
    verifyTurnstileMock.mockResolvedValue({ success: true })
    prismaMock.seller.findUnique.mockResolvedValue(null)
    transactionClient.seller.create.mockResolvedValue({ id: 'seller-1' })
    transactionClient.sellerBankDetail.create.mockResolvedValue({
      id: 'bank-detail-1',
    })
    transactionClient.user.update.mockResolvedValue({ id: 'seller-user-1' })
    transactionClient.twoFactor.upsert.mockResolvedValue({
      id: 'seller-factor-1',
    })
  })

  it('enables seller 2FA and creates the email OTP marker in the onboarding transaction', async () => {
    const response = await POST(makeRequest())

    expect(response.status).toBe(201)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(transactionClient.user.update).toHaveBeenCalledWith({
      where: { id: 'seller-user-1' },
      data: {
        role: 'seller',
        twoFactorEnabled: true,
      },
    })
    expect(transactionClient.twoFactor.upsert).toHaveBeenCalledWith({
      where: { userId: 'seller-user-1' },
      update: {},
      create: {
        userId: 'seller-user-1',
        secret: 'seller-email-otp-only-v1',
        backupCodes: '[]',
        verified: false,
      },
    })
  })
})
