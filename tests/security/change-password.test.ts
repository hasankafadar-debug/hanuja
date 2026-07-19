import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const routes = [
  '../../apps/web/src/app/api/user/change-password/route.ts',
  '../../apps/seller-panel/src/app/api/seller/change-password/route.ts',
  '../../apps/admin-panel/src/app/api/admin/change-password/route.ts',
]

describe('change-password routes', () => {
  for (const route of routes) {
    it(`${route} enforces the shared security contract`, async () => {
      const source = await readFile(new URL(route, import.meta.url), 'utf8')
      expect(source).toContain('checkCsrf(request)')
      expect(source).toContain('checkUserRateLimit')
      expect(source).toContain('HIGH_RISK_RATE_LIMIT')
      expect(source).toContain("currentPassword: z.string().min(1)")
      expect(source).toContain('revokeOtherSessions: true')
      expect(source).toMatch(/session\.user\.role !== '(customer|seller|admin)'/)
    })
  }

  it('web change-password route enforces the customer password policy', async () => {
    const source = await readFile(
      new URL('../../apps/web/src/app/api/user/change-password/route.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('customerPasswordSchema')
  })

  it('seller change-password route enforces the seller password policy', async () => {
    const source = await readFile(
      new URL('../../apps/seller-panel/src/app/api/seller/change-password/route.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('sellerPasswordSchema')
  })
})
