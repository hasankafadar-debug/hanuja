import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ revoke: vi.fn() }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/lib/rate-limit', () => ({ checkRateLimit: async () => ({ allowed: true }), API_RATE_LIMIT: {} }))
vi.mock('@hanuja/api/services/marketing-consent.service', () => ({ createMarketingConsentService: () => ({ revokeByToken: mocks.revoke }) }))
import { GET, POST } from '../../../apps/web/src/app/api/marketing/unsubscribe/route'
describe('anonymous marketing unsubscribe', () => {
  beforeEach(() => mocks.revoke.mockReset().mockResolvedValue({ revoked: true }))
  it('redirects GET scanners to confirmation without revoking', async () => {
    const response = await GET(new NextRequest('https://www.hanuja.com.tr/api/marketing/unsubscribe?token=old-token'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe('https://www.hanuja.com.tr/abonelikten-cik?token=old-token')
    expect(mocks.revoke).not.toHaveBeenCalled()
  })
  it('accepts RFC8058 POST without login and repeated withdrawal', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await POST(new NextRequest('https://www.hanuja.com.tr/api/marketing/unsubscribe?token=old-token', { method: 'POST', body: 'List-Unsubscribe=One-Click' }))
      expect(response.status).toBe(200)
    }
    expect(mocks.revoke).toHaveBeenCalledWith('old-token', 'unsubscribe_post')
  })
  it('rejects absent or unknown tokens', async () => {
    expect((await POST(new NextRequest('https://www.hanuja.com.tr/api/marketing/unsubscribe', { method: 'POST' }))).status).toBe(400)
    mocks.revoke.mockResolvedValue(null)
    expect((await POST(new NextRequest('https://www.hanuja.com.tr/api/marketing/unsubscribe?token=unknown', { method: 'POST' }))).status).toBe(404)
  })
})
