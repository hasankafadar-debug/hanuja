/**
 * Security tests — permission matrix enforcement on finance-critical admin routes
 *
 * `packages/security/src/permission-matrix.ts` is the single source of truth
 * for role → action authorization. Six finance-critical admin routes now call
 * `assertRoleCan` (api/lib/authorize.ts), which bridges `assertCan` to a
 * `ForbiddenError` (403) instead of the previous inline
 * `role !== 'admin'` check. Behavior for `admin` is unchanged today; the
 * value is that a future finance/support role split only requires a matrix
 * data change, not new route code.
 *
 * Covered actions: payout:release, payment:approve_eft, payment:reject_eft,
 * penalty:waive, penalty:apply, finance:adjust_manual.
 *
 * 05-security-rules.md, .claude/rules/10-admin-panel-rules.md,
 * docs/05-security/admin-action-policy.md
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { can, assertCan, PermissionDeniedError, type Action, type UserRole } from '../../packages/security/src/permission-matrix'
import { assertRoleCan } from '../../api/lib/authorize'
import { ForbiddenError } from '../../api/lib/errors'

const FINANCE_CRITICAL_ACTIONS: Action[] = [
  'payout:release',
  'payment:approve_eft',
  'payment:reject_eft',
  'penalty:waive',
  'penalty:apply',
  'finance:adjust_manual',
]

const NON_ADMIN_ROLES: UserRole[] = ['customer', 'seller', 'support']

describe('permission matrix — finance-critical actions are admin-only', () => {
  it.each(FINANCE_CRITICAL_ACTIONS)('admin can perform %s', (action) => {
    expect(can('admin', action)).toBe(true)
  })

  for (const role of NON_ADMIN_ROLES) {
    it.each(FINANCE_CRITICAL_ACTIONS)(`${role} cannot perform %s`, (action) => {
      expect(can(role, action)).toBe(false)
    })
  }
})

describe('assertCan — throws PermissionDeniedError for unauthorized roles', () => {
  it.each(FINANCE_CRITICAL_ACTIONS)('throws when seller attempts %s', (action) => {
    expect(() => assertCan('seller', action)).toThrow(PermissionDeniedError)
  })

  it.each(FINANCE_CRITICAL_ACTIONS)('throws when customer attempts %s', (action) => {
    expect(() => assertCan('customer', action)).toThrow(PermissionDeniedError)
  })

  it.each(FINANCE_CRITICAL_ACTIONS)('does not throw when admin attempts %s', (action) => {
    expect(() => assertCan('admin', action)).not.toThrow()
  })
})

describe('assertRoleCan — bridges matrix denial to ForbiddenError (403)', () => {
  it.each(FINANCE_CRITICAL_ACTIONS)('throws ForbiddenError (403) when seller attempts %s', (action) => {
    expect(() => assertRoleCan('seller', action)).toThrow(ForbiddenError)
    try {
      assertRoleCan('seller', action)
      expect.fail('expected assertRoleCan to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError)
      expect((err as ForbiddenError).statusCode).toBe(403)
    }
  })

  it.each(FINANCE_CRITICAL_ACTIONS)('does not throw for admin on %s', (action) => {
    expect(() => assertRoleCan('admin', action)).not.toThrow()
  })

  it('rejects an unknown/unmapped role string safely (denied, not a crash)', () => {
    expect(() => assertRoleCan('unknown-role', 'payout:release')).toThrow(ForbiddenError)
  })
})

// ─── Route-level example: payout release requires payout:release ──────────────

const { getSessionMock, releasePayoutMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  releasePayoutMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock('@hanuja/api/routes/payouts', () => ({
  releasePayout: releasePayoutMock,
}))

describe('POST /api/admin/payouts/[id]/release — permission matrix enforcement', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    releasePayoutMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
  })

  function buildRequest() {
    return new Request('http://localhost/api/admin/payouts/p1/release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }) as unknown as Parameters<
      typeof import('../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route').POST
    >[0]
  }

  const ctx = { params: Promise.resolve({ id: 'p1' }) }

  it('returns 403 for seller role (lacks payout:release)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u1', role: 'seller' } })
    const route = await import('../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest(), ctx)
    expect(response.status).toBe(403)
    expect(releasePayoutMock).not.toHaveBeenCalled()
  })

  it('returns 401 when no session present (unaffected by matrix change)', async () => {
    getSessionMock.mockResolvedValue(null)
    const route = await import('../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest(), ctx)
    expect(response.status).toBe(401)
    expect(releasePayoutMock).not.toHaveBeenCalled()
  })

  it('allows admin role (has payout:release)', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const route = await import('../../apps/admin-panel/src/app/api/admin/payouts/[id]/release/route')
    const response = await route.POST(buildRequest(), ctx)
    expect(response.status).toBe(200)
    expect(releasePayoutMock).toHaveBeenCalledTimes(1)
  })
})
