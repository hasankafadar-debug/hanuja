/**
 * Announcement routes (e-mail plan phase 5): CSRF is the first gate on every admin
 * mutation, only admins reach the service, send/retry are bound to a preview hash,
 * and a seller can only mark their own announcement read. The admin media routes
 * that carry announcement uploads now enforce CSRF too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { generateCsrfToken } from '../../packages/security/src/csrf'
import { ForbiddenError, NotFoundError } from '../../api/lib/errors'

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  getOperationalSellerIdOrThrow: vi.fn(),
  checkRateLimit: vi.fn(),
  checkUserRateLimit: vi.fn(),
  service: {
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    deleteDraft: vi.fn(),
    send: vi.fn(),
    retryFailed: vi.fn(),
    updateAfterSend: vi.fn(),
    markRead: vi.fn(),
  },
  media: { requestUploadUrl: vi.fn(), confirmUpload: vi.fn() },
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: h.getSession } } }))
// `@/` resolves to the seller panel in tests; load the real admin helper for its imports.
vi.mock('@/lib/announcement-route', async () => import('../../apps/admin-panel/src/lib/announcement-route'))
vi.mock('@/lib/route-seller', () => ({ getOperationalSellerIdOrThrow: h.getOperationalSellerIdOrThrow }))
vi.mock('@hanuja/api/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  checkUserRateLimit: h.checkUserRateLimit,
  SENSITIVE_RATE_LIMIT: { limit: 10, windowMs: 60_000 },
}))
vi.mock('@hanuja/api/lib/prisma', () => ({ createPrismaForRoute: () => ({}) }))
vi.mock('@hanuja/api/services/announcement.service', () => ({
  createAnnouncementService: () => h.service,
}))
vi.mock('@hanuja/api/services/media.service', () => ({ createMediaService: () => h.media }))

import { POST as createPost } from '../../apps/admin-panel/src/app/api/admin/announcements/route'
import {
  DELETE as draftDelete,
  PATCH as draftPatch,
} from '../../apps/admin-panel/src/app/api/admin/announcements/[id]/route'
import { POST as sendPost } from '../../apps/admin-panel/src/app/api/admin/announcements/[id]/send/route'
import { POST as retryPost } from '../../apps/admin-panel/src/app/api/admin/announcements/[id]/retry/route'
import { PUT as sentContentPut } from '../../apps/admin-panel/src/app/api/admin/announcements/[id]/sent-content/route'
import { POST as uploadUrlPost } from '../../apps/admin-panel/src/app/api/admin/media/upload-url/route'
import { POST as confirmPost } from '../../apps/admin-panel/src/app/api/admin/media/[id]/confirm/route'
import { POST as sellerReadPost } from '../../apps/seller-panel/src/app/api/seller/announcements/[id]/read/route'

const HASH = 'a'.repeat(64)
const params = { params: Promise.resolve({ id: 'a1' }) }

function request(method: string, body?: unknown, csrf = true) {
  const token = generateCsrfToken()
  return new NextRequest('http://localhost/api/test', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(csrf ? { cookie: `hanuja-csrf=${token}`, 'x-csrf-token': token } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

const draftBody = {
  version: 2,
  title: 'Başlık',
  body: 'Metin',
  mediaAssetId: null,
  posterAssetId: null,
  audience: { mode: 'all' },
}

type Handler = (req: NextRequest, ctx: typeof params) => Promise<Response>
const adminMutations: Array<[string, Handler, string, unknown]> = [
  ['create draft', (req) => createPost(req), 'POST', undefined],
  ['save draft', draftPatch, 'PATCH', draftBody],
  ['delete draft', draftDelete, 'DELETE', undefined],
  ['send', sendPost, 'POST', { version: 2, audienceHash: HASH }],
  ['retry', retryPost, 'POST', { reason: 'SMTP ayarı düzeltildi', eligibleHash: HASH }],
  ['edit after send', sentContentPut, 'PUT', { version: 3, title: 'Başlık', body: 'Metin' }],
  ['media upload url', (req) => uploadUrlPost(req), 'POST', { folder: 'announcements', mimeType: 'video/mp4' }],
  ['media confirm', confirmPost, 'POST', undefined],
]

describe('admin announcement routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CSRF_STRICT', 'true')
    h.getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    h.checkUserRateLimit.mockResolvedValue({ allowed: true, response: null })
    for (const fn of Object.values(h.service)) fn.mockResolvedValue({ ok: true })
    h.media.requestUploadUrl.mockResolvedValue({ asset: { id: 'm1' }, uploadUrl: 'https://r2.test', expiresIn: 300 })
    h.media.confirmUpload.mockResolvedValue({ id: 'm1' })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(adminMutations)('%s rejects a missing CSRF token before reading the session', async (_name, handler, method, body) => {
    const response = await handler(request(method, body, false), params)
    expect(response.status).toBe(403)
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it.each(adminMutations)('%s is admin-only', async (_name, handler, method, body) => {
    for (const role of ['customer', 'seller']) {
      h.getSession.mockResolvedValue({ user: { id: 'user-1', role } })
      expect((await handler(request(method, body), params)).status).toBe(403)
    }
    h.getSession.mockResolvedValue(null)
    expect((await handler(request(method, body), params)).status).toBe(401)
    for (const fn of Object.values(h.service)) expect(fn).not.toHaveBeenCalled()
    expect(h.media.requestUploadUrl).not.toHaveBeenCalled()
  })

  it('binds a send to the previewed version and hash, as the signed-in admin', async () => {
    expect((await sendPost(request('POST', { version: 2, audienceHash: HASH }), params)).status).toBe(200)
    expect(h.service.send).toHaveBeenCalledWith('admin-1', 'a1', { version: 2, audienceHash: HASH })

    h.service.send.mockClear()
    expect((await sendPost(request('POST', { version: 2, audienceHash: 'not-a-hash' }), params)).status).toBe(422)
    expect((await sendPost(request('POST', { version: 2 }), params)).status).toBe(422)
    expect(h.service.send).not.toHaveBeenCalled()
  })

  it('requires a retry reason of at least 10 characters', async () => {
    expect((await retryPost(request('POST', { reason: 'kısa', eligibleHash: HASH }), params)).status).toBe(422)
    expect(h.service.retryFailed).not.toHaveBeenCalled()
  })

  it('rate-limits send before parsing the body', async () => {
    h.checkUserRateLimit.mockResolvedValue({
      allowed: false,
      response: NextResponse.json({ error: 'Çok fazla istek.' }, { status: 429 }),
    })
    expect((await sendPost(request('POST', { version: 2, audienceHash: HASH }), params)).status).toBe(429)
    expect(h.service.send).not.toHaveBeenCalled()
  })

  it('rejects an empty or malformed body with 400, not 500', async () => {
    const token = generateCsrfToken()
    const malformed = new NextRequest('http://localhost/api/test', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: `hanuja-csrf=${token}`, 'x-csrf-token': token },
      body: '{bozuk',
    })
    expect((await draftPatch(malformed, params)).status).toBe(400)
  })
})

describe('seller announcement read route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CSRF_STRICT', 'true')
    h.getSession.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
    h.getOperationalSellerIdOrThrow.mockResolvedValue('seller-1')
    h.checkRateLimit.mockResolvedValue({ allowed: true, response: null })
    h.checkUserRateLimit.mockResolvedValue({ allowed: true, response: null })
    h.service.markRead.mockResolvedValue({ advanced: true })
  })
  afterEach(() => vi.unstubAllEnvs())

  it('checks CSRF before the session', async () => {
    expect((await sellerReadPost(request('POST', {}, false), params)).status).toBe(403)
    expect(h.getSession).not.toHaveBeenCalled()
  })

  it('marks the announcement read for the signed-in seller only', async () => {
    const response = await sellerReadPost(request('POST', {}), params)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, data: { advanced: true } })
    expect(h.service.markRead).toHaveBeenCalledWith('seller-1', 'a1')
  })

  it('returns 404 for an announcement addressed to another seller', async () => {
    h.service.markRead.mockRejectedValue(new NotFoundError('Duyuru'))
    expect((await sellerReadPost(request('POST', {}), params)).status).toBe(404)
  })

  it('rejects a seller whose application is not approved and an anonymous user', async () => {
    h.getOperationalSellerIdOrThrow.mockRejectedValue(new ForbiddenError('Satıcı hesabı sipariş işlemlerine kapalı'))
    expect((await sellerReadPost(request('POST', {}), params)).status).toBe(403)
    h.getSession.mockResolvedValue(null)
    expect((await sellerReadPost(request('POST', {}), params)).status).toBe(401)
    expect(h.service.markRead).not.toHaveBeenCalled()
  })
})
