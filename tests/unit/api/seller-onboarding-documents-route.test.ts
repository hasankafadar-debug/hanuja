import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, uploadDocumentMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: {
    seller: { findUnique: vi.fn() },
  },
  uploadDocumentMock: vi.fn(),
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
    uploadDocument: uploadDocumentMock,
  })),
}))

import { POST } from '../../../apps/seller-panel/src/app/api/seller/documents/route'

function pdfFile(name = 'kimlik.pdf'): File {
  return new File([Buffer.from('%PDF-1.7\nprivate document')], name, {
    type: 'application/pdf',
  })
}

function makeRequest(type: string, file: File = pdfFile(), identityPart?: string) {
  const body = new FormData()
  body.set('type', type)
  if (identityPart) body.set('identityPart', identityPart)
  body.set('file', file)
  return new NextRequest('http://seller.example/api/seller/documents', {
    method: 'POST',
    body,
  })
}

function setSeller(params: {
  requiredDocumentTypes: string[]
  documents?: Array<{ type: string; identityPart?: string | null; fileKey?: string }>
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
    uploadDocumentMock.mockReset()
    getSessionMock.mockReset()
    getSessionMock.mockResolvedValue({ user: { id: 'user-1', role: 'seller' } })
    uploadDocumentMock.mockResolvedValue({
      id: 'new-document',
      sellerId: 'seller-1',
      type: 'identity',
      identityPart: 'combined',
      status: 'pending',
      fileUrl: 'private://seller-document',
      fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
      fileName: 'kimlik.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 25,
      adminNote: null,
      createdAt: new Date('2026-07-21T10:00:00.000Z'),
    })
  })

  it('rejects a document type that the administrator did not request', async () => {
    setSeller({
      requiredDocumentTypes: ['identity', 'tax_certificate', 'signature_circular'],
    })

    const response = await POST(makeRequest('trade_registry'))

    expect(response.status).toBe(403)
    expect(uploadDocumentMock).not.toHaveBeenCalled()
  })

  it.each(['pending', 'approved'])(
    'rejects a duplicate type when a %s document already occupies the requested slot',
    async () => {
      setSeller({
        requiredDocumentTypes: ['identity'],
        documents: [
          {
            type: 'identity',
            identityPart: 'combined',
            fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
          },
        ],
      })

      const response = await POST(makeRequest('identity'))

      expect(response.status).toBe(409)
      expect(uploadDocumentMock).not.toHaveBeenCalled()
    },
  )

  it('accepts multipart bytes server-side and returns an authenticated download URL', async () => {
    setSeller({ requiredDocumentTypes: ['identity'], documents: [] })
    const file = pdfFile()

    const response = await POST(makeRequest('identity', file))

    expect(response.status).toBe(201)
    expect(uploadDocumentMock).toHaveBeenCalledWith({
      sellerId: 'seller-1',
      type: 'identity',
      identityPart: 'combined',
      fileName: 'kimlik.pdf',
      mimeType: 'application/pdf',
      bytes: expect.any(Uint8Array),
    })
    const uploadedBytes = uploadDocumentMock.mock.calls[0]?.[0].bytes as Uint8Array
    expect(Buffer.from(uploadedBytes).subarray(0, 5).toString('ascii')).toBe('%PDF-')
    await expect(response.json()).resolves.toMatchObject({
      document: {
        id: 'new-document',
        fileUrl: '/api/seller/documents/new-document/file',
      },
    })
  })

  it('allows identity front and back as separate occupied slots', async () => {
    setSeller({
      requiredDocumentTypes: ['identity'],
      documents: [
        {
          type: 'identity',
          identityPart: 'front',
          fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
        },
      ],
    })

    const response = await POST(makeRequest('identity', pdfFile('kimlik-arka.pdf'), 'back'))

    expect(response.status).toBe(201)
    expect(uploadDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'identity', identityPart: 'back' }),
    )
  })

  it('rejects mixing a combined identity with separate face uploads', async () => {
    setSeller({
      requiredDocumentTypes: ['identity'],
      documents: [
        {
          type: 'identity',
          identityPart: 'front',
          fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
        },
      ],
    })

    const response = await POST(makeRequest('identity', pdfFile(), 'combined'))

    expect(response.status).toBe(409)
    expect(uploadDocumentMock).not.toHaveBeenCalled()
  })

  it('allows a requested type when only a rejected predecessor exists', async () => {
    // The route query intentionally excludes rejected documents so the seller can resubmit.
    setSeller({ requiredDocumentTypes: ['identity'], documents: [] })

    const response = await POST(makeRequest('identity'))

    expect(response.status).toBe(201)
    expect(uploadDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId: 'seller-1', type: 'identity' }),
    )
  })

  it('requires a multipart file before invoking the storage service', async () => {
    setSeller({ requiredDocumentTypes: ['identity'], documents: [] })
    const body = new FormData()
    body.set('type', 'identity')
    const request = new NextRequest('http://seller.example/api/seller/documents', {
      method: 'POST',
      body,
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    expect(uploadDocumentMock).not.toHaveBeenCalled()
  })
})
