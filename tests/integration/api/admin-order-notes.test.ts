import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  add: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('../../../api/services/admin-order-note.service', async (original) => ({
  ...(await original<object>()),
  createAdminOrderNoteService: () => ({ add: mocks.add }),
}))
import { POST } from '../../../apps/admin-panel/src/app/api/admin/orders/[id]/notes/route'

const context = { params: Promise.resolve({ id: 'order-1' }) }
const req = (body: unknown) =>
  new Request('https://admin.test/api/admin/orders/order-1/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

describe('private admin order note route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.csrf.mockReturnValue(null)
    mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    mocks.add.mockResolvedValue({
      id: 'note-1',
      createdAt: new Date('2026-10-07T09:00:00Z'),
    })
  })
  it.each([null, 'seller', 'customer'])('rejects non-admin session %s', async (role) => {
    mocks.session.mockResolvedValue(role ? { user: { id: 'user-1', role } } : null)
    expect((await POST(req({ body: 'private note' }), context)).status).toBe(role ? 403 : 401)
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('checks CSRF before using the session', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await POST(req({ body: 'note' }), context)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it.each(['', '   ', 'x'.repeat(5001)])('rejects invalid note content', async (body) => {
    expect((await POST(req({ body }), context)).status).toBe(422)
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('binds author to the session and returns the server timestamp', async () => {
    const response = await POST(
      req({
        body: '  Called customer\nDelivery verified  ',
        authorId: 'spoofed',
      }),
      context,
    )
    expect(response.status).toBe(201)
    expect(mocks.add).toHaveBeenCalledWith({
      orderId: 'order-1',
      authorId: 'admin-1',
      body: 'Called customer\nDelivery verified',
    })
    expect(await response.json()).toMatchObject({
      data: { id: 'note-1', createdAt: '2026-10-07T09:00:00.000Z' },
    })
  })
})
