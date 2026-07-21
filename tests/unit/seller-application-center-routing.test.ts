import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, getSessionMock, redirectMock } = vi.hoisted(() => ({
  prismaMock: { seller: { findUnique: vi.fn() } },
  getSessionMock: vi.fn(),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`)
  }),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {
    constructor() {
      return prismaMock
    }
  },
}))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

import BasvuruPage from '../../apps/seller-panel/src/app/basvuru/page'
import { getSellerFromSession } from '../../apps/seller-panel/src/lib/seller-session'

describe('pending seller application-center routing', () => {
  beforeEach(() => {
    prismaMock.seller.findUnique.mockReset()
    getSessionMock.mockReset()
    redirectMock.mockClear()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
  })

  it('keeps a pending seller out of operational panel pages', async () => {
    prismaMock.seller.findUnique.mockResolvedValue({
      id: 'seller-1',
      userId: 'user-1',
      status: 'pending',
    })

    await expect(getSellerFromSession()).rejects.toThrow('REDIRECT:/basvuru')
    expect(redirectMock).toHaveBeenCalledWith('/basvuru')
  })

  it('sends the pending application entry to the authenticated document center', async () => {
    prismaMock.seller.findUnique.mockResolvedValue({ status: 'pending' })

    await expect(BasvuruPage()).rejects.toThrow('REDIRECT:/basvuru/belgeler')
    expect(redirectMock).toHaveBeenCalledWith('/basvuru/belgeler')
  })

  it('allows an active seller through the panel session guard', async () => {
    const activeSeller = {
      id: 'seller-1',
      userId: 'user-1',
      status: 'active',
    }
    prismaMock.seller.findUnique.mockResolvedValue(activeSeller)

    await expect(getSellerFromSession()).resolves.toEqual({
      session: { user: { id: 'user-1', role: 'seller' } },
      seller: activeSeller,
    })
  })
})
