import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError, ValidationError } from '../../../api/lib/errors'

const { generatePresignedUploadUrlMock, deleteObjectMock, objectExistsMock } = vi.hoisted(() => ({
  generatePresignedUploadUrlMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  objectExistsMock: vi.fn(),
}))

vi.mock('../../../api/lib/r2', () => ({
  generatePresignedUploadUrl: generatePresignedUploadUrlMock,
  deleteObject: deleteObjectMock,
  objectExists: objectExistsMock,
  DOCUMENT_ALLOWED_MIME_TYPES: new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]),
  DOCUMENT_MAX_SIZE_BYTES: 20 * 1024 * 1024,
}))

import { createSellerDocumentService } from '../../../api/services/seller-document.service'

type SellerDocumentRecord = {
  id: string
  sellerId: string
  type: string
  status: 'pending' | 'approved' | 'rejected'
  fileKey: string
  fileUrl?: string
  fileName?: string
  mimeType?: string
  sizeBytes?: number
  adminNote?: string | null
  reviewedBy?: string | null
  reviewedAt?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

function createPrismaMock(initialDocuments: SellerDocumentRecord[] = []) {
  const docs = new Map(initialDocuments.map((doc) => [doc.id, { ...doc }]))
  const createdAuditLogs: Array<Record<string, unknown>> = []

  const prisma = {
    sellerDocument: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: 'doc-created',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as SellerDocumentRecord
        docs.set(created.id, created)
        return created
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => docs.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where?: { sellerId?: string } }) => {
        const all = [...docs.values()]
        return where?.sellerId ? all.filter((doc) => doc.sellerId === where.sellerId) : all
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const current = docs.get(where.id) ?? null
        if (current) docs.delete(where.id)
        return current
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = docs.get(where.id)
          if (!current) {
            throw new Error(`Missing sellerDocument ${where.id}`)
          }
          const updated = {
            ...current,
            ...data,
          } as SellerDocumentRecord
          docs.set(where.id, updated)
          return updated
        },
      ),
    },
    adminAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdAuditLogs.push(data)
        return data
      }),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma)),
  }

  return { prisma, docs, createdAuditLogs }
}

function makeDocument(overrides: Partial<SellerDocumentRecord> = {}): SellerDocumentRecord {
  return {
    id: 'doc-1',
    sellerId: 'seller-1',
    type: 'identity',
    status: 'pending',
    fileKey: 'documents/seller-1/doc-1.pdf',
    fileUrl: 'https://cdn.example/doc-1.pdf',
    fileName: 'kimlik.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    updatedAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  generatePresignedUploadUrlMock.mockReset()
  deleteObjectMock.mockReset()
  objectExistsMock.mockReset()

  generatePresignedUploadUrlMock.mockResolvedValue({
    uploadUrl: 'https://upload.example/presigned',
    key: 'documents/seller-1/generated.pdf',
    publicUrl: 'https://cdn.example/generated.pdf',
    expiresIn: 300,
  })
  deleteObjectMock.mockResolvedValue(undefined)
  objectExistsMock.mockResolvedValue(true)
})

describe('SellerDocumentService', () => {
  it('rejects unsupported mime types', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({ prisma: prisma as never })

    await expect(
      service.requestUploadUrl({
        sellerId: 'seller-1',
        type: 'identity' as never,
        fileName: 'kimlik.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 512,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(generatePresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('rejects files larger than 20 MB', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({ prisma: prisma as never })

    await expect(
      service.requestUploadUrl({
        sellerId: 'seller-1',
        type: 'identity' as never,
        fileName: 'kimlik.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 20 * 1024 * 1024 + 1,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(generatePresignedUploadUrlMock).not.toHaveBeenCalled()
  })

  it('allows deleting only the seller-owned pending document', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await service.deleteDocument('doc-1', 'seller-1')

    expect(docs.has('doc-1')).toBe(false)
    expect(deleteObjectMock).toHaveBeenCalledWith('documents/seller-1/doc-1.pdf')
  })

  it('blocks deleting another seller document', async () => {
    const { prisma } = createPrismaMock([makeDocument({ sellerId: 'seller-2' })])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('blocks deleting non-pending documents', async () => {
    const { prisma } = createPrismaMock([makeDocument({ status: 'approved' })])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('removes orphan pending records when upload confirmation cannot verify the R2 object', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })
    objectExistsMock.mockResolvedValue(false)

    await expect(service.confirmUpload('doc-1', 'seller-1')).rejects.toMatchObject({
      message: 'Dosya yüklemesi doğrulanamadı. Lütfen tekrar deneyin.',
    })

    expect(docs.has('doc-1')).toBe(false)
  })

  it('touches the document when upload confirmation verifies the R2 object', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await service.confirmUpload('doc-1', 'seller-1')

    expect(objectExistsMock).toHaveBeenCalledWith('documents/seller-1/doc-1.pdf')
    expect(prisma.sellerDocument.update).toHaveBeenCalledTimes(1)
    expect(docs.get('doc-1')?.updatedAt).toBeInstanceOf(Date)
  })

  it('requires a note when rejecting a document', async () => {
    const { prisma } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await expect(
      service.reviewDocument({
        documentId: 'doc-1',
        adminId: 'admin-1',
        decision: 'rejected',
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('creates an audit log without undefined reason on approval', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await service.reviewDocument({
      documentId: 'doc-1',
      adminId: 'admin-1',
      decision: 'approved',
    })

    expect(docs.get('doc-1')?.status).toBe('approved')
    expect(createdAuditLogs).toHaveLength(1)
    expect(createdAuditLogs[0]).toMatchObject({
      actorId: 'admin-1',
      actionType: 'seller_document_approved',
      targetType: 'SellerDocument',
      targetId: 'doc-1',
    })
    expect(createdAuditLogs[0]).not.toHaveProperty('reason')
  })

  it('blocks approval when the uploaded object is missing from R2', async () => {
    const { prisma, docs, createdAuditLogs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })
    objectExistsMock.mockResolvedValue(false)

    await expect(
      service.reviewDocument({
        documentId: 'doc-1',
        adminId: 'admin-1',
        decision: 'approved',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(docs.get('doc-1')?.status).toBe('pending')
    expect(createdAuditLogs).toHaveLength(0)
  })

  it('creates an audit log with reason on rejection', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never })

    await service.reviewDocument({
      documentId: 'doc-1',
      adminId: 'admin-1',
      decision: 'rejected',
      note: 'Belge okunamıyor',
    })

    expect(docs.get('doc-1')).toMatchObject({
      status: 'rejected',
      adminNote: 'Belge okunamıyor',
      reviewedBy: 'admin-1',
    })
    expect(createdAuditLogs[0]).toMatchObject({
      actionType: 'seller_document_rejected',
      reason: 'Belge okunamıyor',
    })
  })
})
