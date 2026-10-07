import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({
  outbox: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  find: vi.fn(),
  transaction: vi.fn(),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: async () => ({ user: { id: 'admin-1', role: 'admin' } }) } },
}))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: () => null }))
vi.mock('@hanuja/api/lib/prisma', () => ({
  createPrismaForRoute: () => ({
    seller: { findUnique: mocks.find },
    $transaction: mocks.transaction,
  }),
}))
vi.mock('@hanuja/api/lib/mailer', () => ({
  sendEmail: () => {
    throw new Error('SMTP must not be called by document request')
  },
}))
import { POST } from '../../../apps/admin-panel/src/app/api/admin/sellers/[id]/request-documents/route'

describe('durable admin document request mail', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.find.mockResolvedValue({
      id: 'seller-1',
      userId: 'seller-user-1',
      documentsRequestedAt: null,
      user: { email: 'seller@example.test' },
    })
    mocks.audit.mockResolvedValue({ id: 'audit-1' })
    mocks.outbox.mockResolvedValue({ id: 'outbox-1' })
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        seller: { update: mocks.update },
        adminAuditLog: { create: mocks.audit },
        notificationOutbox: { upsert: mocks.outbox },
      }),
    )
  })
  const request = () =>
    new NextRequest('https://admin.hanuja.com.tr/api/admin/sellers/seller-1/request-documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requiredDocTypes: ['identity'], note: '<note>' }),
    })
  it('returns success and persists the recipient, document list and note in the same transaction', async () => {
    const response = await POST(request(), { params: Promise.resolve({ id: 'seller-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.outbox).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          type: 'seller_documents_requested',
          userId: 'seller-user-1',
          payload: expect.objectContaining({
            emailTo: 'seller@example.test',
            data: {
              email: 'seller@example.test',
              requiredDocTypes: ['Kimlik Belgesi'],
              note: '<note>',
            },
          }),
        }),
      }),
    )
  })
  it('does not claim success when durable intent cannot be saved', async () => {
    mocks.outbox.mockRejectedValue(new Error('OUTBOX_UNAVAILABLE'))
    const response = await POST(request(), { params: Promise.resolve({ id: 'seller-1' }) })
    expect(response.status).toBe(500)
  })
})
