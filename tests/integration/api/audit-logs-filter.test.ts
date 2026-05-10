/**
 * Integration test — admin audit-logs route filters.
 * Verifies from / to / actionType / actorEmail / skip / take are forwarded.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getSessionMock,
  createPrismaForRouteMock,
  listRecentMock,
  createRepoMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  createPrismaForRouteMock: vi.fn(),
  listRecentMock: vi.fn(),
  createRepoMock: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))

vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: createPrismaForRouteMock,
}))

vi.mock('@hanuja/api/repositories/admin-audit-log.repository', () => ({
  createAdminAuditLogRepository: createRepoMock,
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  createPrismaForRouteMock.mockReturnValue({})
  createRepoMock.mockReturnValue({ listRecent: listRecentMock })
  listRecentMock.mockResolvedValue([])
})

function buildRequest(query: string) {
  return new Request(`http://localhost/api/admin/audit-logs?${query}`)
}

describe('GET /api/admin/audit-logs — auth', () => {
  it('401 without session', async () => {
    getSessionMock.mockResolvedValue(null)
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    const res = await route.GET(buildRequest('') as never)
    expect(res.status).toBe(401)
    expect(listRecentMock).not.toHaveBeenCalled()
  })

  it('403 for non-admin role', async () => {
    getSessionMock.mockResolvedValue({ user: { id: 'u', role: 'seller' } })
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    const res = await route.GET(buildRequest('') as never)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin/audit-logs — filter forwarding', () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
  })

  it('forwards default skip/take when no params provided', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    const res = await route.GET(buildRequest('') as never)
    expect(res.status).toBe(200)
    expect(listRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 50 }),
    )
  })

  it('parses single actionType into a one-element array', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('actionType=payout_released') as never)
    expect(listRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ actionTypes: ['payout_released'] }),
    )
  })

  it('parses multiple comma-separated actionTypes', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('actionType=payout_released,penalty_waived,seller_suspended') as never)
    expect(listRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionTypes: ['payout_released', 'penalty_waived', 'seller_suspended'],
      }),
    )
  })

  it('coerces from/to dates into UTC range bounds', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('from=2026-04-01&to=2026-04-30') as never)
    const args = listRecentMock.mock.calls[0]?.[0] as { from: Date; to: Date }
    expect(args.from.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(args.to.toISOString()).toBe('2026-04-30T23:59:59.999Z')
  })

  it('forwards actorEmail when provided', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('actorEmail=hasan%40example.com') as never)
    expect(listRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorEmail: 'hasan@example.com' }),
    )
  })

  it('honors custom skip and take pagination', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('skip=100&take=25') as never)
    expect(listRecentMock).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 100, take: 25 }),
    )
  })

  it('drops empty actionType strings (?actionType=)', async () => {
    const route = await import('../../../apps/admin-panel/src/app/api/admin/audit-logs/route')
    await route.GET(buildRequest('actionType=') as never)
    const args = listRecentMock.mock.calls[0]?.[0] as { actionTypes?: string[] }
    expect(args.actionTypes).toBeUndefined()
  })
})
