import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrivateDocumentStorage } from '../../../api/lib/private-document-storage'
import { ForbiddenError, ValidationError } from '../../../api/lib/errors'
import {
  createSellerDocumentService,
  LEGACY_DOCUMENT_REUPLOAD_MESSAGE,
} from '../../../api/services/seller-document.service'

type SellerDocumentRecord = {
  id: string
  sellerId: string
  type: string
  status: 'pending' | 'approved' | 'rejected'
  fileKey: string
  fileUrl: string
  fileName: string
  mimeType: string
  sizeBytes: number
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
      findMany: vi.fn(
        async ({ where }: { where?: { sellerId?: string; type?: string; status?: string } }) => {
          const all = [...docs.values()]
          return all.filter(
            (doc) =>
              (!where?.sellerId || doc.sellerId === where.sellerId) &&
              (!where?.type || doc.type === where.type) &&
              (!where?.status || doc.status === where.status),
          )
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const current = docs.get(where.id) ?? null
        if (current) docs.delete(where.id)
        return current
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = docs.get(where.id)
          if (!current) throw new Error(`Missing sellerDocument ${where.id}`)
          const updated = { ...current, ...data } as SellerDocumentRecord
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
    fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    fileUrl: 'private://seller-document',
    fileName: 'kimlik.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    updatedAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }
}

function makeLegacyDocument(overrides: Partial<SellerDocumentRecord> = {}): SellerDocumentRecord {
  return makeDocument({
    fileKey: 'documents/seller-1/legacy.pdf',
    fileUrl: 'https://cdn.example/documents/seller-1/legacy.pdf',
    ...overrides,
  })
}

function pdfBytes(body = 'test document'): Uint8Array {
  return Buffer.from(`%PDF-1.7\n${body}`, 'utf8')
}

function createStorageMock() {
  const storage: PrivateDocumentStorage = {
    write: vi.fn(async () => ({
      key: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
      encryptedSizeBytes: 128,
    })),
    read: vi.fn(async () => Buffer.from('decrypted document')),
    exists: vi.fn(async () => true),
    delete: vi.fn(async () => undefined),
  }
  return storage
}

let storage: PrivateDocumentStorage

beforeEach(() => {
  storage = createStorageMock()
})

describe('SellerDocumentService private KYC uploads', () => {
  it('stores validated bytes in private storage and persists only an opaque key', async () => {
    const { prisma, docs } = createPrismaMock()
    const service = createSellerDocumentService({ prisma: prisma as never, storage })
    const bytes = pdfBytes()

    const document = await service.uploadDocument({
      sellerId: 'seller-1',
      type: 'identity' as never,
      fileName: '  kimlik.pdf  ',
      mimeType: 'application/pdf',
      bytes,
    })

    expect(storage.write).toHaveBeenCalledWith(bytes)
    expect(document).toMatchObject({
      id: 'doc-created',
      sellerId: 'seller-1',
      fileUrl: 'private://seller-document',
      fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
      fileName: 'kimlik.pdf',
      sizeBytes: bytes.byteLength,
    })
    expect(docs.get('doc-created')?.fileUrl).not.toMatch(/^https?:/)
  })

  it('marks legacy R2 records as unavailable and requiring reupload', async () => {
    const privateDocument = makeDocument()
    const legacyDocument = makeLegacyDocument({ id: 'doc-legacy', type: 'tax_certificate' })
    const { prisma } = createPrismaMock([privateDocument, legacyDocument])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.listDocuments('seller-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'doc-1', requiresReupload: false, fileAvailable: true }),
        expect.objectContaining({
          id: 'doc-legacy',
          requiresReupload: true,
          fileAvailable: false,
        }),
      ]),
    )
  })

  it('replaces a legacy R2 record only after the private document is persisted', async () => {
    const legacyDocument = makeLegacyDocument()
    const { prisma, docs } = createPrismaMock([legacyDocument])
    const deleteLegacyObject = vi.fn(async () => undefined)
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
      deleteLegacyObject,
    })

    const document = await service.uploadDocument({
      sellerId: 'seller-1',
      type: 'identity' as never,
      fileName: 'yeni-kimlik.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes(),
    })

    expect(document).toMatchObject({
      id: 'doc-created',
      requiresReupload: false,
      fileAvailable: true,
    })
    expect(deleteLegacyObject).toHaveBeenCalledWith(legacyDocument.fileKey)
    expect(prisma.sellerDocument.create.mock.invocationCallOrder[0]).toBeLessThan(
      deleteLegacyObject.mock.invocationCallOrder[0]!,
    )
    expect(docs.has('doc-1')).toBe(false)
    expect(docs.has('doc-created')).toBe(true)
  })

  it('rolls back the private replacement when the untouched legacy object cannot be deleted', async () => {
    const legacyDocument = makeLegacyDocument()
    const { prisma, docs } = createPrismaMock([legacyDocument])
    const deleteLegacyObject = vi.fn(async () => {
      throw new Error('R2 unavailable')
    })
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
      deleteLegacyObject,
    })

    await expect(
      service.uploadDocument({
        sellerId: 'seller-1',
        type: 'identity' as never,
        fileName: 'yeni-kimlik.pdf',
        mimeType: 'application/pdf',
        bytes: pdfBytes(),
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Eski belge') })

    expect(docs.has('doc-1')).toBe(true)
    expect(docs.has('doc-created')).toBe(false)
    expect(storage.delete).toHaveBeenCalledWith(
      'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    )
  })

  it.each([
    {
      label: 'unsupported MIME type',
      mimeType: 'application/x-msdownload',
      bytes: pdfBytes(),
    },
    {
      label: 'content that does not match the declared MIME type',
      mimeType: 'application/pdf',
      bytes: Buffer.from('not a pdf'),
    },
    {
      label: 'empty content',
      mimeType: 'application/pdf',
      bytes: new Uint8Array(),
    },
    {
      label: 'content larger than 20 MB',
      mimeType: 'application/pdf',
      bytes: Buffer.concat([Buffer.from('%PDF-', 'ascii'), Buffer.alloc(20 * 1024 * 1024)]),
    },
  ])('rejects $label before writing a file', async ({ mimeType, bytes }) => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.uploadDocument({
        sellerId: 'seller-1',
        type: 'identity' as never,
        fileName: 'kimlik.pdf',
        mimeType,
        bytes,
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(storage.write).not.toHaveBeenCalled()
    expect(prisma.sellerDocument.create).not.toHaveBeenCalled()
  })

  it('removes the encrypted object when database persistence fails', async () => {
    const { prisma } = createPrismaMock()
    prisma.sellerDocument.create.mockRejectedValueOnce(new Error('database unavailable'))
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.uploadDocument({
        sellerId: 'seller-1',
        type: 'identity' as never,
        fileName: 'kimlik.pdf',
        mimeType: 'application/pdf',
        bytes: pdfBytes(),
      }),
    ).rejects.toThrow('database unavailable')

    expect(storage.delete).toHaveBeenCalledWith(
      'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    )
  })

  it('decrypts a document through the private storage adapter', async () => {
    const document = makeDocument()
    const { prisma } = createPrismaMock([document])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.readDocumentFile('doc-1')).resolves.toEqual({
      document,
      bytes: Buffer.from('decrypted document'),
    })
    expect(storage.read).toHaveBeenCalledWith(document.fileKey)
  })

  it('fails closed when a legacy R2 document is read or checked', async () => {
    const { prisma } = createPrismaMock([makeLegacyDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.readDocumentFile('doc-1')).rejects.toMatchObject({
      message: LEGACY_DOCUMENT_REUPLOAD_MESSAGE,
    })
    await expect(service.documentFileExists('doc-1')).rejects.toMatchObject({
      message: LEGACY_DOCUMENT_REUPLOAD_MESSAGE,
    })
    expect(storage.read).not.toHaveBeenCalled()
    expect(storage.exists).not.toHaveBeenCalled()
  })

  it('deletes encrypted bytes before removing a seller-owned pending record', async () => {
    const document = makeDocument()
    const { prisma, docs } = createPrismaMock([document])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await service.deleteDocument('doc-1', 'seller-1')

    expect(storage.delete).toHaveBeenCalledWith(document.fileKey)
    expect(prisma.sellerDocument.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } })
    expect(docs.has('doc-1')).toBe(false)
  })

  it('keeps the database record when encrypted byte deletion fails', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.delete).mockRejectedValueOnce(new Error('volume unavailable'))
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toThrow('volume unavailable')

    expect(prisma.sellerDocument.delete).not.toHaveBeenCalled()
    expect(docs.has('doc-1')).toBe(true)
  })

  it('blocks deleting another seller document', async () => {
    const { prisma } = createPrismaMock([makeDocument({ sellerId: 'seller-2' })])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(ForbiddenError)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('blocks deleting non-pending documents', async () => {
    const { prisma } = createPrismaMock([makeDocument({ status: 'approved' })])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('removes an orphan record when compatibility confirmation finds no private file', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.exists).mockResolvedValueOnce(false)
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.confirmUpload('doc-1', 'seller-1')).rejects.toBeInstanceOf(ValidationError)

    expect(docs.has('doc-1')).toBe(false)
  })

  it('does not confirm or delete a legacy record through private storage', async () => {
    const { prisma, docs } = createPrismaMock([makeLegacyDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(service.confirmUpload('doc-1', 'seller-1')).rejects.toMatchObject({
      message: LEGACY_DOCUMENT_REUPLOAD_MESSAGE,
    })

    expect(storage.exists).not.toHaveBeenCalled()
    expect(docs.has('doc-1')).toBe(true)
  })

  it('requires private bytes to decrypt before approval', async () => {
    const { prisma, docs, createdAuditLogs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.read).mockRejectedValueOnce(new Error('authentication failed'))
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

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

  it('blocks approving a legacy R2 document without attempting a read', async () => {
    const { prisma, docs, createdAuditLogs } = createPrismaMock([makeLegacyDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.reviewDocument({
        documentId: 'doc-1',
        adminId: 'admin-1',
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ message: LEGACY_DOCUMENT_REUPLOAD_MESSAGE })

    expect(storage.read).not.toHaveBeenCalled()
    expect(docs.get('doc-1')?.status).toBe('pending')
    expect(createdAuditLogs).toHaveLength(0)
  })

  it('approves a decryptable document and records the admin decision', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await service.reviewDocument({
      documentId: 'doc-1',
      adminId: 'admin-1',
      decision: 'approved',
    })

    expect(storage.read).toHaveBeenCalledOnce()
    expect(docs.get('doc-1')?.status).toBe('approved')
    expect(createdAuditLogs[0]).toMatchObject({
      actorId: 'admin-1',
      actionType: 'seller_document_approved',
      targetId: 'doc-1',
    })
    expect(createdAuditLogs[0]).not.toHaveProperty('reason')
  })

  it('requires and audits a reason for rejection without reading the file', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock([makeDocument()])
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.reviewDocument({
        documentId: 'doc-1',
        adminId: 'admin-1',
        decision: 'rejected',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    await service.reviewDocument({
      documentId: 'doc-1',
      adminId: 'admin-1',
      decision: 'rejected',
      note: '  Belge okunamıyor  ',
    })

    expect(storage.read).not.toHaveBeenCalled()
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
