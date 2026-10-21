import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  addAddress: vi.fn(),
  updateAddress: vi.fn(),
}))
vi.mock('../../api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('../../api/services/user.service', () => ({
  createUserService: () => mocks,
}))
vi.mock('../../api/services/checkout.service', () => ({
  createCheckoutService: () => mocks,
}))

import { addAddress, updateAddress } from '../../api/routes/user'
import { addAddress as addCheckoutAddress } from '../../api/routes/checkout'

const billing = {
  fullName: 'Test Müşteri',
  phone: '05321234567',
  addressLine1: 'Test Cad. No 1',
  district: 'Kadıköy',
  city: 'İstanbul',
  isBillingAddress: true,
  invoiceType: 'individual',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.addAddress.mockResolvedValue({ id: 'address-1' })
  mocks.updateAddress.mockResolvedValue({ id: 'address-1' })
})

describe.each([
  ['account create', (req: NextRequest) => addAddress(req, 'customer-1'), 201],
  ['checkout create', (req: NextRequest) => addCheckoutAddress(req, 'customer-1'), 201],
  ['account update', (req: NextRequest) => updateAddress(req, 'customer-1', 'address-1'), 200],
] as const)('%s: customer invoice identity', (_, handler, successStatus) => {
  function request(data: Record<string, unknown>) {
    return new NextRequest('http://localhost/api/user/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  it.each([undefined, ''])(
    'accepts an individual billing address without TC (%s)',
    async (tcNumber) => {
      const response = await handler(
        request({
          ...billing,
          ...(tcNumber === undefined ? {} : { tcNumber }),
        }),
      )
      expect(response.status).toBe(successStatus)
      const saved = (mocks.addAddress.mock.calls[0] ?? mocks.updateAddress.mock.calls[0])!
      expect(JSON.stringify(saved)).not.toContain('11111111111')
    },
  )

  it('still rejects an invalid TC when the customer supplies one', async () => {
    expect((await handler(request({ ...billing, tcNumber: '123' }))).status).toBe(422)
    expect(mocks.addAddress).not.toHaveBeenCalled()
    expect(mocks.updateAddress).not.toHaveBeenCalled()
  })

  it('still requires company invoice information for a corporate profile', async () => {
    expect((await handler(request({ ...billing, invoiceType: 'corporate' }))).status).toBe(422)
  })
})
