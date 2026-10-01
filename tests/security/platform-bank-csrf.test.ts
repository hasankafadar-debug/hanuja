import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() }))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/platform-bank-account.service', () => ({ createPlatformBankAccountService: () => mocks }))
import { POST } from '../../apps/admin-panel/src/app/api/admin/bank-accounts/route'
import { PATCH, DELETE } from '../../apps/admin-panel/src/app/api/admin/bank-accounts/[id]/route'

const token = 'a'.repeat(64)
const body = { accountHolder: 'Offline Test', bankName: 'Test Bank', iban: `TR${'0'.repeat(24)}` }
function request(method: string, csrf: 'missing' | 'mismatch' | 'valid') {
  return new NextRequest('https://admin.example.test/api/admin/bank-accounts/account', {
    method, headers: { 'content-type': 'application/json', ...(csrf === 'missing' ? {} : {
      cookie: `hanuja-csrf=${token}`, 'x-csrf-token': csrf === 'valid' ? token : 'b'.repeat(64),
    }) }, body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'admin-test', role: 'admin' } })
  mocks.create.mockResolvedValue({ id: 'account' })
  mocks.update.mockResolvedValue({ id: 'account' })
})
afterEach(() => vi.unstubAllEnvs())
describe.each([
  ['POST', (req: NextRequest) => POST(req), mocks.create],
  ['PATCH', (req: NextRequest) => PATCH(req, { params: Promise.resolve({ id: 'account' }) }), mocks.update],
  ['DELETE', (req: NextRequest) => DELETE(req, { params: Promise.resolve({ id: 'account' }) }), mocks.delete],
] as const)('platform bank %s', (method, handler, mutation) => {
  it.each(['missing', 'mismatch'] as const)('rejects %s token before reading the session or changing bank details', async csrf => {
    expect((await handler(request(method, csrf))).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
    expect(mutation).not.toHaveBeenCalled()
  })
  it('preserves valid admin requests', async () => {
    expect((await handler(request(method, 'valid'))).status).toBe(method === 'POST' ? 201 : 200)
    expect(mutation).toHaveBeenCalledOnce()
  })
  it('rejects a customer with a valid CSRF token', async () => {
    mocks.session.mockResolvedValue({ user: { id: 'customer-test', role: 'customer' } })
    expect((await handler(request(method, 'valid'))).status).toBe(401)
    expect(mutation).not.toHaveBeenCalled()
  })
})
