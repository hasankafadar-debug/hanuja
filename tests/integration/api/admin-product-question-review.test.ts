import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  csrf: vi.fn(),
  complete: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: mocks.session } } }))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: mocks.csrf }))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('../../../api/services/product-question.service', () => ({
  createProductQuestionService: () => ({ completeAdminReview: mocks.complete }),
}))
import { POST } from '../../../apps/admin-panel/src/app/api/admin/product-questions/[id]/review-complete/route'

const context = { params: Promise.resolve({ id: 't1' }) }
const request = (body: unknown) =>
  new Request('https://admin.test/api/admin/product-questions/t1/review-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.csrf.mockReturnValue(null)
  mocks.session.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
  mocks.complete.mockResolvedValue({ status: 'waiting_for_customer' })
})

describe('admin product question review completion route', () => {
  it.each([null, 'customer', 'seller'])('rejects session role %s', async (role) => {
    mocks.session.mockResolvedValue(role ? { user: { id: 'other', role } } : null)
    expect((await POST(request({ lastSeenMessageId: 'm1' }), context)).status).toBe(
      role ? 403 : 401,
    )
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('checks CSRF before the session', async () => {
    mocks.csrf.mockReturnValue(new Response(null, { status: 403 }))
    expect((await POST(request({ lastSeenMessageId: 'm1' }), context)).status).toBe(403)
    expect(mocks.session).not.toHaveBeenCalled()
  })
  it.each([{}, { lastSeenMessageId: '' }, { lastSeenMessageId: 'x'.repeat(65) }])(
    'requires the last viewed message',
    async (body) => {
      expect((await POST(request(body), context)).status).toBe(422)
      expect(mocks.complete).not.toHaveBeenCalled()
    },
  )
  it('binds the admin identity to the session', async () => {
    const response = await POST(request({ lastSeenMessageId: 'm1', adminId: 'spoofed' }), context)
    expect(response.status).toBe(200)
    expect(mocks.complete).toHaveBeenCalledWith({
      threadId: 't1',
      adminId: 'admin-1',
      lastSeenMessageId: 'm1',
    })
  })
})
