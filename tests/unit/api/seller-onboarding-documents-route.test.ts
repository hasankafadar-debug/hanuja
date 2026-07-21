import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, requestUploadUrlMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    seller: { findUnique: vi.fn() },
  },
  requestUploadUrlMock: vi.fn(),
  getSessionMock: vi.fn(),
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {
    constructor() {
      return prismaMock
    }
  },
}))

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: getSessionMock } },
}))
vi.mock('@hanuja/api/lib/csrf-check', () => ({ checkCsrf: vi.fn(() => null) }))
vi.mock('@hanuja/api/services/seller-document.service', () => ({
  createSellerDocumentService: vi.fn(() => ({
    requestUploadUrl: requestUploadUrlMock,
  })),
}))

import { POST } from '../../../apps/seller-panel/src/app/api/seller/documents/route'

function makeRequest(type: string) {
  return new NextRequest('http://seller.example/api/seller/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type,
      fileName: `${type}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    }),
  })
}

function setSeller(params: {
  requiredDocumentTypes: string[]
  documents?: Array<{ type: string }>
}) {
  prismaMock.seller.findUnique.mockResolvedValue({
    id: 'seller-1',
    status: 'pending',
    requiredDocumentTypes: params.requiredDocumentTypes,
    documents: params.documents ?? [],
  })
}

describe('POST /api/seller/documents for pending applicants', () => {
  beforeEach(() => {
    prismaMock.seller.findUnique.mockReset()
    requestUploadUrlMock.mockReset()
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
    requestUploadUrlMock.mockResolvedValue({
      document: { id: 'new-document' },
      uploadUrl: 'https://upload.example/presigned',
      expiresIn: 300,
    })
  })

  it('rejects a document type that the administrator did not request', async () => {
    setSeller({
      requiredDocumentTypes: ['identity', 'tax_certificate', 'signature_circular'],
    })

    const response = await POST(makeRequest('trade_registry'))

    expect(response.status).toBe(403)
    expect(requestUploadUrlMock).not.toHaveBeenCalled()
  })

  it.each(['pending', 'approved'])(
    'rejects a duplicate type when a %s document already occupies the requested slot',
    async () => {
      setSeller({ requiredDocumentTypes: ['identity'], documents: [{ type: 'identity' }] })

      const response = await POST(makeRequest('identity'))

      expect(response.status).toBe(409)
      expect(requestUploadUrlMock).not.toHaveBeenCalled()
    },
  )

  it('allows the requested type when only a rejected predecessor exists', async () => {
    // The route query intentionally returns only pending/approved documents. A
    // rejected predecessor is therefore represented by an empty active slot.
    setSeller({ requiredDocumentTypes: ['identity'], documents: [] })

    const response = await POST(makeRequest('identity'))

    expect(response.status).toBe(201)
    expect(requestUploadUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: 'seller-1', type: 'identity' }),
    )
  })
})
