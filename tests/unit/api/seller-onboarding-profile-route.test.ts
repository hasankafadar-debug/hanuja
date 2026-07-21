import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, updateProfileMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    seller: { findUnique: vi.fn() },
    sellerDocument: { findFirst: vi.fn() },
  },
  updateProfileMock: vi.fn(),
  getSessionMock: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {
    constructor() {
      return prismaMock
    }
  },
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: vi.fn(() => null) }))
vi.mock('@hanuja/api/services/seller.service', () => ({
  createSellerService: vi.fn(() => ({ updateProfile: updateProfileMock })),
}))

import { PATCH } from '../../../apps/seller-panel/src/app/api/seller/profile/route'

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://seller.example/api/seller/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/seller/profile pending applicant lock', () => {
  beforeEach(() => {
    prismaMock.seller.findUnique.mockReset()
    prismaMock.sellerDocument.findFirst.mockReset()
    updateProfileMock.mockReset()
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
    prismaMock.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      userId: 'user-1',
      status: 'pending',
    })
    updateProfileMock.mockResolvedValue(undefined)
  })

  it.each([
    ['companyName', 'Yeni Şirket A.Ş.'],
    ['legalAddress', 'Yeni yasal adres'],
    ['taxOffice', 'Yeni Vergi Dairesi'],
    ['taxNumber', '1234567890'],
    ['mersis', '0123456789012345'],
  ] as const)('blocks %s changes after the first document upload', async (field, value) => {
    prismaMock.sellerDocument.findFirst.mockResolvedValue({ id: 'first-document' })

    const response = await PATCH(makeRequest({ [field]: value }))

    expect(response.status).toBe(409)
    expect(updateProfileMock).not.toHaveBeenCalled()
  })

  it('still allows store and contact fields after a document upload', async () => {
    prismaMock.sellerDocument.findFirst.mockResolvedValue({ id: 'first-document' })

    const response = await PATCH(
      makeRequest({
        storeName: 'Yeni Mağaza',
        bio: 'Yeni açıklama',
        phone: '05551234567',
      }),
    )

    expect(response.status).toBe(200)
    expect(prismaMock.sellerDocument.findFirst).not.toHaveBeenCalled()
    expect(updateProfileMock).toHaveBeenCalledWith(
      'seller-1',
      'user-1',
      expect.objectContaining({
        storeName: 'Yeni Mağaza',
        bio: 'Yeni açıklama',
        phone: '05551234567',
      }),
    )
  })

  it('allows legal fields before the first document upload', async () => {
    prismaMock.sellerDocument.findFirst.mockResolvedValue(null)

    const response = await PATCH(
      makeRequest({
        companyName: 'Yeni Şirket Ltd.',
        taxNumber: '1234567890',
      }),
    )

    expect(response.status).toBe(200)
    expect(updateProfileMock).toHaveBeenCalledWith(
      'seller-1',
      'user-1',
      expect.objectContaining({
        companyName: 'Yeni Şirket Ltd.',
        taxNumber: '1234567890',
      }),
    )
  })
})
