import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { Decimal } from '@prisma/client/runtime/client'

const {
  checkUserRateLimitMock,
  approveEftMock,
  rejectEftMock,
  createPlatformSettingsServiceMock,
  getSessionMock,
  moderateReviewMock,
  platformSettingsGetMock,
  platformSettingsUpdateMock,
  prismaMock,
  reviewReturnRequestMock,
  revokeTrustedDevicesMock,
  setPasswordMock,
} = vi.hoisted(() => {
  const platformSettingsGetMock = vi.fn()
  const platformSettingsUpdateMock = vi.fn()
  const prismaMock = {
    penalty: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  }

  return {
    approveEftMock: vi.fn(),
    rejectEftMock: vi.fn(),
    checkUserRateLimitMock: vi.fn(),
    createPlatformSettingsServiceMock: vi.fn(() => ({
      get: platformSettingsGetMock,
      update: platformSettingsUpdateMock,
    })),
    getSessionMock: vi.fn(),
    moderateReviewMock: vi.fn(),
    platformSettingsGetMock,
    platformSettingsUpdateMock,
    prismaMock,
    reviewReturnRequestMock: vi.fn(),
    revokeTrustedDevicesMock: vi.fn(),
    setPasswordMock: vi.fn(),
  }
})

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {
    constructor() {
      return prismaMock
    }
  },
}))
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
      setPassword: setPasswordMock,
    },
  },
}))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  HIGH_RISK_RATE_LIMIT: {},
  checkUserRateLimit: checkUserRateLimitMock,
}))
vi.mock('@hanuja/api/lib/auth-security', () => ({
  revokeTrustedDevices: revokeTrustedDevicesMock,
}))
vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: vi.fn(() => prismaMock),
}))
vi.mock('@hanuja/api/services/platform-settings.service', () => ({
  createPlatformSettingsService: createPlatformSettingsServiceMock,
}))
vi.mock('@hanuja/api/routes/product-reviews', () => ({
  moderateReview: moderateReviewMock,
}))
vi.mock('@hanuja/api/routes/returns', () => ({
  reviewReturnRequest: reviewReturnRequestMock,
}))
vi.mock('@hanuja/api/routes/payments', () => ({
  approveEft: approveEftMock,
  rejectEft: rejectEftMock,
}))

import { POST as firstPasswordPost } from '../../apps/seller-panel/src/app/api/seller/first-password/route'
import { PUT as updatePenalty } from '../../apps/admin-panel/src/app/api/admin/penalties/[id]/route'
import { PATCH as updatePlatformSettings } from '../../apps/admin-panel/src/app/api/admin/platform-settings/route'
import { POST as moderateReviewPost } from '../../apps/admin-panel/src/app/api/admin/reviews/[id]/moderate/route'
import { POST as reviewReturnPost } from '../../apps/admin-panel/src/app/api/admin/returns/[id]/review/route'
import { POST as approveEftPost } from '../../apps/admin-panel/src/app/api/admin/payments/eft/[orderId]/approve/route'
import { POST as rejectEftPost } from '../../apps/admin-panel/src/app/api/admin/payments/eft/[orderId]/reject/route'

const VALID_CSRF_TOKEN = 'a'.repeat(64)
const INVALID_CSRF_TOKEN = 'b'.repeat(64)
const ADMIN_SESSION = { user: { id: 'admin-1', role: 'admin' } }
const SELLER_SESSION = { user: { id: 'seller-1', role: 'seller' } }

function request(
  path: string,
  body: Record<string, unknown>,
  csrf: 'valid' | 'missing' | 'mismatch' = 'valid',
  method: 'PATCH' | 'POST' | 'PUT' = 'POST',
) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (csrf !== 'missing') {
    headers.set('cookie', `hanuja-csrf=${VALID_CSRF_TOKEN}`)
    headers.set('x-csrf-token', csrf === 'valid' ? VALID_CSRF_TOKEN : INVALID_CSRF_TOKEN)
  }

  return new NextRequest(`https://panel.example.test${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  })
}

const originalNodeEnv = process.env['NODE_ENV']
const originalCsrfStrict = process.env['CSRF_STRICT']

beforeEach(() => {
  vi.clearAllMocks()
  process.env['NODE_ENV'] = 'production'
  delete process.env['CSRF_STRICT']

  getSessionMock.mockResolvedValue(ADMIN_SESSION)
  checkUserRateLimitMock.mockResolvedValue({ allowed: true, response: null })
  setPasswordMock.mockResolvedValue(undefined)
  revokeTrustedDevicesMock.mockResolvedValue(undefined)
  prismaMock.user.update.mockResolvedValue(undefined)

  const currentPenalty = {
    id: 'penalty-1',
    status: 'applied',
    reason: 'Prior reason',
    baseAmount: new Decimal(100),
    rate: new Decimal(0.1),
    penaltyAmount: new Decimal(10),
  }
  prismaMock.penalty.findUnique.mockResolvedValue(currentPenalty)
  prismaMock.penalty.update.mockResolvedValue(currentPenalty)

  platformSettingsGetMock.mockResolvedValue({
    defaultTaxRate: new Decimal(0.2),
  })
  platformSettingsUpdateMock.mockResolvedValue({ id: 'platform' })
  moderateReviewMock.mockResolvedValue(NextResponse.json({ success: true }))
  reviewReturnRequestMock.mockResolvedValue(NextResponse.json({ success: true }))
  approveEftMock.mockResolvedValue(NextResponse.json({ success: true }))
  rejectEftMock.mockResolvedValue(NextResponse.json({ success: true }))
})

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env['NODE_ENV']
  else process.env['NODE_ENV'] = originalNodeEnv
  if (originalCsrfStrict === undefined) delete process.env['CSRF_STRICT']
  else process.env['CSRF_STRICT'] = originalCsrfStrict
})

describe('POST /api/seller/first-password in production', () => {
  it.each(['missing', 'mismatch'] as const)(
    'returns 403 before auth or state changes for a %s CSRF token',
    async (csrf) => {
      const response = await firstPasswordPost(
        request('/api/seller/first-password', { newPassword: 'ValidPassword1!' }, csrf),
      )

      expect(response.status).toBe(403)
      expect(getSessionMock).not.toHaveBeenCalled()
      expect(checkUserRateLimitMock).not.toHaveBeenCalled()
      expect(setPasswordMock).not.toHaveBeenCalled()
      expect(revokeTrustedDevicesMock).not.toHaveBeenCalled()
      expect(prismaMock.user.update).not.toHaveBeenCalled()
    },
  )

  it('passes a matching token pair into the authenticated password-change flow', async () => {
    getSessionMock.mockResolvedValue(SELLER_SESSION)

    const response = await firstPasswordPost(
      request('/api/seller/first-password', { newPassword: 'ValidPassword1!' }),
    )

    expect(response.status).toBe(200)
    expect(getSessionMock).toHaveBeenCalledTimes(1)
    expect(checkUserRateLimitMock).toHaveBeenCalledWith('seller-1', 'first-password', {})
    expect(setPasswordMock).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newPassword: 'ValidPassword1!' } }),
    )
    expect(revokeTrustedDevicesMock).toHaveBeenCalledWith(prismaMock, 'seller-1')
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'seller-1' },
      data: { mustChangePassword: false },
    })
  })
})

type AdminTarget = {
  name: string
  invoke: (req: NextRequest) => Promise<Response>
  request: () => NextRequest
  businessSpy: ReturnType<typeof vi.fn>
}

const adminTargets: AdminTarget[] = [
  {
    name: 'penalty update',
    invoke: (req) => updatePenalty(req, { params: Promise.resolve({ id: 'penalty-1' }) }),
    request: () =>
      request(
        '/api/admin/penalties/penalty-1',
        { amount: 15, reason: 'Updated reason' },
        'valid',
        'PUT',
      ),
    businessSpy: prismaMock.penalty.findUnique,
  },
  {
    name: 'platform settings update',
    invoke: (req) => updatePlatformSettings(req as Parameters<typeof updatePlatformSettings>[0]),
    request: () =>
      request(
        '/api/admin/platform-settings',
        {
          standardPenaltyRate: 0.2,
          dailyPenaltyRate: 0.01,
          defaultSellerCommissionRate: 0.15,
          fulfillmentDays: 20,
          fulfillmentWarningDays: 5,
          payoutHoldDays: 30,
          freeShippingThresholdTry: 1500,
          flatShippingFeeTry: 99,
          eftDiscountRate: 0,
        },
        'valid',
        'PATCH',
      ),
    businessSpy: platformSettingsGetMock,
  },
  {
    name: 'review moderation',
    invoke: (req) => moderateReviewPost(req, { params: Promise.resolve({ id: 'review-1' }) }),
    request: () => request('/api/admin/reviews/review-1/moderate', { decision: 'approved' }),
    businessSpy: moderateReviewMock,
  },
  {
    name: 'return review',
    invoke: (req) => reviewReturnPost(req, { params: Promise.resolve({ id: 'return-1' }) }),
    request: () => request('/api/admin/returns/return-1/review', { decision: 'approved' }),
    businessSpy: reviewReturnRequestMock,
  },
  {
    name: 'EFT approval',
    invoke: (req) => approveEftPost(req, { params: Promise.resolve({ orderId: 'order-1' }) }),
    request: () => request('/api/admin/payments/eft/order-1/approve', {}),
    businessSpy: approveEftMock,
  },
  {
    name: 'EFT rejection',
    invoke: (req) => rejectEftPost(req, { params: Promise.resolve({ orderId: 'order-1' }) }),
    request: () => request('/api/admin/payments/eft/order-1/reject', { reason: 'Dekont doğrulanamadı' }),
    businessSpy: rejectEftMock,
  },
]

describe('HNJ-SEC-008 admin target routes in production', () => {
  for (const target of adminTargets) {
    it(`returns 403 before auth or business work for ${target.name} without a CSRF token`, async () => {
      const req = target.request()
      req.headers.delete('cookie')
      req.headers.delete('x-csrf-token')

      const response = await target.invoke(req)

      expect(response.status).toBe(403)
      expect(getSessionMock).not.toHaveBeenCalled()
      expect(target.businessSpy).not.toHaveBeenCalled()
    })

    it(`passes a matching token pair into ${target.name}`, async () => {
      const response = await target.invoke(target.request())

      expect(response.status).toBe(200)
      expect(getSessionMock).toHaveBeenCalledTimes(1)
      expect(target.businessSpy).toHaveBeenCalledTimes(1)
    })
  }
})
