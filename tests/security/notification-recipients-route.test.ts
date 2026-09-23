import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateCsrfToken } from '../../packages/security/src/csrf'

const { getSession, list, update } = vi.hoisted(() => ({
  getSession: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/admin-notification.service', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/services/admin-notification.service')
  >('../../api/services/admin-notification.service')
  return {
    ADMIN_NOTIFICATION_EVENTS: actual.ADMIN_NOTIFICATION_EVENTS,
    createAdminNotificationRecipientService: () => ({ list, update }),
  }
})

import {
  GET,
  PUT,
} from '../../apps/admin-panel/src/app/api/admin/notification-recipients/route'

function request(options: { csrf?: boolean; email?: string; event?: string } = {}) {
  const token = generateCsrfToken()
  const csrf = options.csrf ?? true
  return new NextRequest('http://localhost/api/admin/notification-recipients', {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...(csrf ? { cookie: `hanuja-csrf=${token}`, 'x-csrf-token': token } : {}),
    },
    body: JSON.stringify({
      entries: [
        {
          event: options.event ?? 'eft_pending',
          email: options.email ?? 'finans@hanuja.com.tr',
        },
      ],
    }),
  })
}

describe('notification recipient route security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CSRF_STRICT', 'true')
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    list.mockResolvedValue([])
    update.mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects a missing CSRF token before the session is read', async () => {
    expect((await PUT(request({ csrf: false }))).status).toBe(403)
    expect(getSession).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['customer', 'seller'])('rejects %s even with a valid token', async (role) => {
    getSession.mockResolvedValue({ user: { id: 'u-1', role } })
    expect((await PUT(request())).status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests on both verbs', async () => {
    getSession.mockResolvedValue(null)
    expect((await PUT(request())).status).toBe(401)
    expect((await GET()).status).toBe(401)
    expect(update).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })

  it('rejects an invalid e-mail address', async () => {
    const response = await PUT(request({ email: 'not-an-email' }))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an unknown event slug', async () => {
    const response = await PUT(request({ event: 'made_up_event' }))
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('passes the authenticated actor through on a valid change', async () => {
    expect((await PUT(request())).status).toBe(200)
    expect(update).toHaveBeenCalledWith({
      actorId: 'admin-1',
      entries: [{ event: 'eft_pending', email: 'finans@hanuja.com.tr' }],
    })
  })
})
