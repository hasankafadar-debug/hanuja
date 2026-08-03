import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '../../api/lib/errors'

const { getSessionMock, prismaMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  prismaMock: {
    seller: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: getSessionMock } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ default: prismaMock }))

import {
  getActiveSellerIdOrThrow,
  getOperationalSellerIdOrThrow,
} from '../../apps/seller-panel/src/lib/route-seller'

describe('seller temporary-password enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([getActiveSellerIdOrThrow, getOperationalSellerIdOrThrow])(
    'denies seller API guard access until the temporary password is changed',
    async (getSellerId) => {
      getSessionMock.mockResolvedValue({
        user: { id: 'seller-1', role: 'seller', mustChangePassword: true },
      })

      await expect(getSellerId()).rejects.toBeInstanceOf(ForbiddenError)
      expect(prismaMock.seller.findUnique).not.toHaveBeenCalled()
    },
  )

  it('continues to resolve an active seller after the password-change requirement is cleared', async () => {
    getSessionMock.mockResolvedValue({
      user: { id: 'seller-1', role: 'seller', mustChangePassword: false },
    })
    prismaMock.seller.findUnique.mockResolvedValue({ id: 'seller-record-1', status: 'active' })

    await expect(getActiveSellerIdOrThrow()).resolves.toBe('seller-record-1')
  })
})
