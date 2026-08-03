import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, uploadContractGroupMock, getSessionMock } = vi.hoisted(() => ({
  prismaMock: { seller: { findUnique: vi.fn() } },
  uploadContractGroupMock: vi.fn(),
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
  CONTRACT_MAX_TOTAL_SIZE_BYTES: 100 * 1024 * 1024,
  createSellerDocumentService: vi.fn(() => ({
    uploadContractGroup: uploadContractGroupMock,
  })),
}))

import { POST } from '../../../apps/seller-panel/src/app/api/seller/documents/contracts/route'

function pdfFile(name: string) {
  return new File([Buffer.from('%PDF-1.7\ncontract')], name, {
    type: 'application/pdf',
  })
}

function pngFile(name: string) {
  return new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: 'image/png',
  })
}

function makeRequest(files: File[]) {
  const body = new FormData()
  for (const file of files) body.append('files', file)
  return new NextRequest('http://seller.example/api/seller/documents/contracts', {
    method: 'POST',
    body,
  })
}

function setSeller(overrides: Record<string, unknown> = {}) {
  prismaMock.seller.findUnique.mockResolvedValue({
    id: 'seller-1',
    status: 'pending',
    requiredDocumentTypes: ['contract'],
    documents: [],
    ...overrides,
  })
}

describe('POST /api/seller/documents/contracts', () => {
  beforeEach(() => {
    prismaMock.seller.findUnique.mockReset()
    uploadContractGroupMock.mockReset()
    getSessionMock.mockResolvedValue({
      user: { id: 'user-1', role: 'seller' },
    })
    setSeller()
    uploadContractGroupMock.mockResolvedValue({
      groupId: 'group-1',
      documents: [
        {
          id: 'doc-1',
          sellerId: 'seller-1',
          type: 'contract',
          identityPart: null,
          uploadGroupId: 'group-1',
          uploadOrder: 0,
          uploadGroupSize: 1,
          status: 'pending',
          fileName: 'sozlesme.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 20,
          fileUrl: 'private://seller-document',
          fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
          adminNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date('2026-08-03T12:00:00Z'),
          updatedAt: new Date('2026-08-03T12:00:00Z'),
        },
      ],
    })
  })

  it('rejects contract uploads that were not requested for a pending applicant', async () => {
    setSeller({ requiredDocumentTypes: ['identity'] })

    const response = await POST(makeRequest([pdfFile('sozlesme.pdf')]))

    expect(response.status).toBe(403)
    expect(uploadContractGroupMock).not.toHaveBeenCalled()
  })

  it('rejects a second pending or approved contract group during onboarding', async () => {
    setSeller({ documents: [{ status: 'approved' }] })

    const response = await POST(makeRequest([pdfFile('sozlesme.pdf')]))

    expect(response.status).toBe(409)
    expect(uploadContractGroupMock).not.toHaveBeenCalled()
  })

  it('preserves the selected order for mixed PDF and image files', async () => {
    uploadContractGroupMock.mockImplementationOnce(
      async ({ files }: { files: Array<{ fileName: string }> }) => ({
        groupId: 'group-1',
        documents: files.map((file, index) => ({
          id: `doc-${index + 1}`,
          sellerId: 'seller-1',
          type: 'contract',
          identityPart: null,
          uploadGroupId: 'group-1',
          uploadOrder: index,
          uploadGroupSize: files.length,
          status: 'pending',
          fileName: file.fileName,
          mimeType: index === 0 ? 'application/pdf' : 'image/png',
          sizeBytes: 20,
          fileUrl: 'private://seller-document',
          fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
          adminNote: null,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: new Date('2026-08-03T12:00:00Z'),
          updatedAt: new Date('2026-08-03T12:00:00Z'),
        })),
      }),
    )

    const response = await POST(makeRequest([pdfFile('sayfa-1.pdf'), pngFile('sayfa-2.png')]))

    expect(response.status).toBe(201)
    expect(uploadContractGroupMock).toHaveBeenCalledWith({
      sellerId: 'seller-1',
      files: [
        expect.objectContaining({
          fileName: 'sayfa-1.pdf',
          mimeType: 'application/pdf',
        }),
        expect.objectContaining({
          fileName: 'sayfa-2.png',
          mimeType: 'image/png',
        }),
      ],
    })
    await expect(response.json()).resolves.toMatchObject({
      groupId: 'group-1',
      documents: [
        { fileName: 'sayfa-1.pdf', uploadOrder: 0 },
        { fileName: 'sayfa-2.png', uploadOrder: 1 },
      ],
    })
  })

  it('allows an active seller to upload a new version while an older approved version exists', async () => {
    setSeller({
      status: 'active',
      requiredDocumentTypes: null,
      documents: [{ status: 'approved' }],
    })

    const response = await POST(makeRequest([pdfFile('yeni-sozlesme.pdf')]))

    expect(response.status).toBe(201)
    expect(uploadContractGroupMock).toHaveBeenCalledOnce()
  })
})
