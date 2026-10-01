import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => {
  delete (globalThis as { prisma?: unknown }).prisma
  return {
    session: vi.fn(), rate: vi.fn(), sendEmail: vi.fn(), requestChange: vi.fn(),
    seller: { findUnique: vi.fn() },
    verification: { findFirst: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  }
})
vi.mock('@prisma/client', () => ({ PrismaClient: class {
  seller = mocks.seller
  verification = mocks.verification
} }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/rate-limit', () => ({ checkUserRateLimit: mocks.rate, HIGH_RISK_RATE_LIMIT: {} }))
vi.mock('@hanuja/api/lib/mailer', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@hanuja/api/services/seller-bank.service', () => ({ createSellerBankService: () => ({ requestChange: mocks.requestChange }) }))

import { POST as changeBank } from '../../apps/seller-panel/src/app/api/seller/bank-details/route'
import { POST as requestOtp } from '../../apps/seller-panel/src/app/api/seller/bank-details/step-up/request/route'
import { sellerBankOtpIdentifier, sellerBankOtpValue } from '../../api/lib/seller-bank-otp'

const csrf = 'c'.repeat(64)
const code = '123456'
const identifier = 'seller-bank-detail:seller-a:user-a'
const bank = { iban: `TR${'0'.repeat(24)}`, accountHolder: 'Test Seller', bankName: 'Test Bank', otpCode: code }
function request(body = bank, token = csrf) {
  return new NextRequest('https://seller.example.test/api/seller/bank-details', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `hanuja-csrf=${csrf}`, 'x-csrf-token': token },
    body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('BETTER_AUTH_SECRET', 'offline-test-auth-secret-'.repeat(3))
  mocks.session.mockResolvedValue({ user: { id: 'user-a', role: 'seller', mustChangePassword: false } })
  mocks.rate.mockResolvedValue({ allowed: true })
  mocks.seller.findUnique.mockResolvedValue({ id: 'seller-a', status: 'active', user: { email: 'offline@example.test', name: 'Test Seller' } })
  mocks.verification.findFirst.mockResolvedValue({ id: 'otp-record' })
  mocks.verification.deleteMany.mockResolvedValue({ count: 1 })
  mocks.requestChange.mockResolvedValue({})
})
afterEach(() => vi.unstubAllEnvs())

describe('real seller bank OTP handlers', () => {
  it('stores a scoped HMAC and sends only the delivery email a six digit code', async () => {
    expect((await requestOtp(request())).status).toBe(200)
    const sentCode = mocks.sendEmail.mock.calls[0]![0].text.match(/\b\d{6}\b/)[0]
    const stored = mocks.verification.create.mock.calls[0]![0].data
    expect(stored.identifier).toBe(identifier)
    expect(stored.value).toBe(sellerBankOtpValue(identifier, sentCode))
    expect(stored.value).toMatch(/^bank-otp:v1:[a-f0-9]{64}$/)
    expect(stored.value).not.toBe(sentCode)
    expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(590_000)
    expect(mocks.requestChange).not.toHaveBeenCalled()
  })
  it('isolates the same OTP between different sellers and users', () => {
    expect(sellerBankOtpIdentifier('seller-a', 'user-a')).toBe(identifier)
    expect(sellerBankOtpValue(identifier, code)).not.toBe(sellerBankOtpValue('seller-bank-detail:seller-b:user-b', code))
  })
  it('requires a configured runtime secret', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    expect(() => sellerBankOtpValue(identifier, code)).toThrow('BETTER_AUTH_SECRET must be configured')
  })
  it('checks the digest and expiry, then consumes the OTP before the finance change', async () => {
    expect((await changeBank(request())).status).toBe(200)
    const lookup = mocks.verification.findFirst.mock.calls[0]![0].where
    expect(lookup).toEqual({ identifier, value: sellerBankOtpValue(identifier, code), expiresAt: { gt: expect.any(Date) } })
    expect(mocks.verification.deleteMany).toHaveBeenCalledWith({ where: { id: 'otp-record', ...lookup, expiresAt: { gt: expect.any(Date) } } })
    expect(mocks.verification.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.requestChange.mock.invocationCallOrder[0]!)
    expect(mocks.requestChange).toHaveBeenCalledWith(expect.objectContaining({ sellerId: 'seller-a', actorId: 'user-a', iban: bank.iban }))
  })
  it('permits exactly one of two concurrent requests using the same code', async () => {
    let claimed = false
    mocks.verification.deleteMany.mockImplementation(async () => {
      if (claimed) return { count: 0 }
      claimed = true
      return { count: 1 }
    })
    const responses = await Promise.all([changeBank(request()), changeBank(request())])
    expect(responses.map(r => r.status).sort()).toEqual([200, 400])
    expect(mocks.requestChange).toHaveBeenCalledOnce()
  })
  it('rejects a missing or expired verification without changing bank details', async () => {
    mocks.verification.findFirst.mockResolvedValue(null)
    expect((await changeBank(request())).status).toBe(400)
    expect(mocks.verification.deleteMany).not.toHaveBeenCalled()
    expect(mocks.requestChange).not.toHaveBeenCalled()
  })
  it('rejects a code consumed or expired between lookup and claim', async () => {
    mocks.verification.deleteMany.mockResolvedValue({ count: 0 })
    expect((await changeBank(request())).status).toBe(400)
    expect(mocks.requestChange).not.toHaveBeenCalled()
  })
  it('keeps a code consumed if the finance operation fails', async () => {
    mocks.requestChange.mockRejectedValue(new Error('Synthetic bank validation failure'))
    expect((await changeBank(request())).status).toBe(400)
    expect(mocks.verification.deleteMany).toHaveBeenCalledOnce()
  })
  describe.each([['change', changeBank], ['request OTP', requestOtp]] as const)('%s boundary', (_, handler) => {
    it('rejects mismatched CSRF before accessing the session', async () => {
      expect((await handler(request(bank, 'invalid'))).status).toBe(403)
      expect(mocks.session).not.toHaveBeenCalled()
    })
    it.each([
      { role: 'customer', mustChangePassword: false },
      { role: 'admin', mustChangePassword: false },
      { role: 'seller', mustChangePassword: true },
    ])('rejects role/password state %j', async user => {
      mocks.session.mockResolvedValue({ user: { id: 'user-a', ...user } })
      expect((await handler(request())).status).toBe(403)
      expect(mocks.seller.findUnique).not.toHaveBeenCalled()
      expect(mocks.sendEmail).not.toHaveBeenCalled()
      expect(mocks.requestChange).not.toHaveBeenCalled()
    })
    it('rejects an unauthenticated caller', async () => {
      mocks.session.mockResolvedValue(null)
      expect((await handler(request())).status).toBe(401)
    })
    it('honors the high risk rate limit', async () => {
      mocks.rate.mockResolvedValue({ allowed: false, response: new Response(null, { status: 429 }) })
      expect((await handler(request())).status).toBe(429)
      expect(mocks.seller.findUnique).not.toHaveBeenCalled()
    })
    it('rejects a suspended seller', async () => {
      mocks.seller.findUnique.mockResolvedValue({ id: 'seller-a', status: 'suspended' })
      expect((await handler(request())).status).toBe(403)
      expect(mocks.requestChange).not.toHaveBeenCalled()
    })
  })
})
