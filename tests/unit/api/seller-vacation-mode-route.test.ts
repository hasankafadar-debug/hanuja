import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const {
  checkCsrfMock,
  getSessionMock,
  prismaMock,
  updateVacationModeMock,
} = vi.hoisted(() => ({
  checkCsrfMock: vi.fn(),
  getSessionMock: vi.fn(),
  prismaMock: { seller: { findUnique: vi.fn() } },
  updateVacationModeMock: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: getSessionMock } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: vi.fn(() => prismaMock) }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: checkCsrfMock }))
vi.mock('@hanuja/api/services/seller.service', () => ({
  createSellerService: vi.fn(() => ({ updateVacationMode: updateVacationModeMock })),
}))

import { PATCH } from '../../../apps/seller-panel/src/app/api/seller/vacation-mode/route'

function request(body: unknown) {
  return new NextRequest('http://seller.example/api/seller/vacation-mode', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('PATCH /api/seller/vacation-mode', () => {
  beforeEach(() => {
    checkCsrfMock.mockReset()
    checkCsrfMock.mockReturnValue(null)
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    prismaMock.seller.findUnique.mockReset()
    prismaMock.seller.findUnique.mockResolvedValue({ id: 'seller-1' })
    updateVacationModeMock.mockReset()
    updateVacationModeMock.mockImplementation(async (_sellerId, _userId, enabled) => enabled)
  })

  it('rejects requests without a session', async () => {
    getSessionMock.mockResolvedValue(null)
    const response = await PATCH(request({ enabled: true }))
    expect(response.status).toBe(401)
    expect(updateVacationModeMock).not.toHaveBeenCalled()
  })

  it('returns the CSRF rejection before changing state', async () => {
    checkCsrfMock.mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }))
    const response = await PATCH(request({ enabled: true }))
    expect(response.status).toBe(403)
    expect(updateVacationModeMock).not.toHaveBeenCalled()
  })

  it.each([{}, { enabled: 'true' }, { enabled: 1 }])('rejects invalid input %#', async (body) => {
    const response = await PATCH(request(body))
    expect(response.status).toBe(400)
    expect(updateVacationModeMock).not.toHaveBeenCalled()
  })

  it('updates Tatil Modu idempotently and returns the persisted state', async () => {
    const response = await PATCH(request({ enabled: true }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      vacationModeEnabled: true,
    })
    expect(updateVacationModeMock).toHaveBeenCalledWith('seller-1', 'user-1', true)
  })
})
