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
  identityPart?: 'combined' | 'front' | 'back' | null
  uploadGroupId?: string | null
  uploadOrder?: number | null
  uploadGroupSize?: number | null
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
  let createdDocumentCount = 0

  function matchesWhere(doc: SellerDocumentRecord, where?: Record<string, unknown>) {
    if (!where) return true
    return (
      (!where.sellerId || doc.sellerId === where.sellerId) &&
      (!where.type || doc.type === where.type) &&
      (!where.status || doc.status === where.status) &&
      (!where.uploadGroupId || doc.uploadGroupId === where.uploadGroupId)
    )
  }

  const prisma = {
    sellerDocument: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdDocumentCount += 1
        const created = {
          id: createdDocumentCount === 1 ? 'doc-created' : `doc-created-${createdDocumentCount}`,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as SellerDocumentRecord
        docs.set(created.id, created)
        return created
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => docs.get(where.id) ?? null),
      findMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        const all = [...docs.values()]
        return all.filter((doc) => matchesWhere(doc, where))
      }),
      findFirst: vi.fn(
        async ({ where }: { where?: Record<string, unknown> }) =>
          [...docs.values()].find((doc) => matchesWhere(doc, where)) ?? null,
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
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where?: Record<string, unknown>
          data: Record<string, unknown>
        }) => {
          let count = 0
          for (const [id, document] of docs) {
            if (!matchesWhere(document, where)) continue
            docs.set(id, { ...document, ...data } as SellerDocumentRecord)
            count += 1
          }
          return { count }
        },
      ),
      deleteMany: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        let count = 0
        for (const [id, document] of docs) {
          if (!matchesWhere(document, where)) continue
          docs.delete(id)
          count += 1
        }
        return { count }
      }),
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
    identityPart: 'combined',
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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })
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
      identityPart: 'combined',
      fileUrl: 'private://seller-document',
      fileKey: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
      fileName: 'kimlik.pdf',
      sizeBytes: bytes.byteLength,
    })
    expect(docs.get('doc-created')?.fileUrl).not.toMatch(/^https?:/)
  })

  it('allows separate identity front and back slots', async () => {
    const front = makeDocument({ id: 'doc-front', identityPart: 'front' })
    const { prisma, docs } = createPrismaMock([front])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await service.uploadDocument({
      sellerId: 'seller-1',
      type: 'identity' as never,
      identityPart: 'back' as never,
      fileName: 'kimlik-arka.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes(),
    })

    expect(docs.get('doc-created')).toMatchObject({ identityPart: 'back' })
  })

  it('stores an ordered mixed-file contract upload as one group', async () => {
    const { prisma, docs } = createPrismaMock()
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

    const result = await service.uploadContractGroup({
      sellerId: 'seller-1',
      files: [
        {
          fileName: 'sayfa-1.pdf',
          mimeType: 'application/pdf',
          bytes: pdfBytes('page one'),
        },
        { fileName: 'sayfa-2.png', mimeType: 'image/png', bytes: pngBytes },
      ],
    })

    expect(result.groupId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.documents).toHaveLength(2)
    expect([...docs.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'contract',
          uploadGroupId: result.groupId,
          uploadOrder: 0,
          uploadGroupSize: 2,
          fileName: 'sayfa-1.pdf',
        }),
        expect.objectContaining({
          type: 'contract',
          uploadGroupId: result.groupId,
          uploadOrder: 1,
          uploadGroupSize: 2,
          fileName: 'sayfa-2.png',
        }),
      ]),
    )
    expect(storage.write).toHaveBeenCalledTimes(2)
  })

  it('rolls back already-written contract files when a later write fails', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })
    vi.mocked(storage.write)
      .mockResolvedValueOnce({
        key: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
        encryptedSizeBytes: 128,
      })
      .mockRejectedValueOnce(new Error('volume unavailable'))

    await expect(
      service.uploadContractGroup({
        sellerId: 'seller-1',
        files: [
          {
            fileName: 'sayfa-1.pdf',
            mimeType: 'application/pdf',
            bytes: pdfBytes(),
          },
          {
            fileName: 'sayfa-2.pdf',
            mimeType: 'application/pdf',
            bytes: pdfBytes(),
          },
        ],
      }),
    ).rejects.toThrow('volume unavailable')

    expect(storage.delete).toHaveBeenCalledWith(
      'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    )
    expect(prisma.sellerDocument.create).not.toHaveBeenCalled()
  })

  it('enforces contract file-count and total-size limits before storage', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })
    const tinyFiles = Array.from({ length: 51 }, (_, index) => ({
      fileName: `sayfa-${index + 1}.pdf`,
      mimeType: 'application/pdf',
      bytes: pdfBytes(),
    }))

    await expect(
      service.uploadContractGroup({ sellerId: 'seller-1', files: tinyFiles }),
    ).rejects.toBeInstanceOf(ValidationError)

    const largePdf = Buffer.concat([
      Buffer.from('%PDF-', 'ascii'),
      Buffer.alloc(18 * 1024 * 1024 - 5),
    ])
    await expect(
      service.uploadContractGroup({
        sellerId: 'seller-1',
        files: Array.from({ length: 6 }, (_, index) => ({
          fileName: `buyuk-${index + 1}.pdf`,
          mimeType: 'application/pdf',
          bytes: largePdf,
        })),
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('toplam boyutu'),
    })
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('accepts the exact 50-file and 100 MB contract boundaries', async () => {
    const fiftyFileSetup = createPrismaMock()
    const fiftyFileStorage = createStorageMock()
    const fiftyFileService = createSellerDocumentService({
      prisma: fiftyFileSetup.prisma as never,
      storage: fiftyFileStorage,
    })

    await expect(
      fiftyFileService.uploadContractGroup({
        sellerId: 'seller-1',
        files: Array.from({ length: 50 }, (_, index) => ({
          fileName: `sayfa-${index + 1}.pdf`,
          mimeType: 'application/pdf',
          bytes: pdfBytes(),
        })),
      }),
    ).resolves.toMatchObject({ documents: expect.any(Array) })
    expect(fiftyFileStorage.write).toHaveBeenCalledTimes(50)

    const exactLimitSetup = createPrismaMock()
    const exactLimitStorage = createStorageMock()
    const exactLimitService = createSellerDocumentService({
      prisma: exactLimitSetup.prisma as never,
      storage: exactLimitStorage,
    })
    const exactTwentyMbPdf = Buffer.concat([
      Buffer.from('%PDF-', 'ascii'),
      Buffer.alloc(20 * 1024 * 1024 - 5),
    ])

    await expect(
      exactLimitService.uploadContractGroup({
        sellerId: 'seller-2',
        files: Array.from({ length: 5 }, (_, index) => ({
          fileName: `bolum-${index + 1}.pdf`,
          mimeType: 'application/pdf',
          bytes: exactTwentyMbPdf,
        })),
      }),
    ).resolves.toMatchObject({ documents: expect.any(Array) })
    expect(exactLimitStorage.write).toHaveBeenCalledTimes(5)
  })

  it('rejects invalid contract MIME types and signatures before storage', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.uploadContractGroup({
        sellerId: 'seller-1',
        files: [
          {
            fileName: 'sozlesme.txt',
            mimeType: 'text/plain',
            bytes: Buffer.from('contract'),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(
      service.uploadContractGroup({
        sellerId: 'seller-1',
        files: [
          {
            fileName: 'sahte.pdf',
            mimeType: 'application/pdf',
            bytes: Buffer.from('not a pdf'),
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(storage.write).not.toHaveBeenCalled()
  })

  it('cleans up all encrypted files when the contract database transaction fails', async () => {
    const { prisma } = createPrismaMock()
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error('database unavailable'))
    vi.mocked(storage.write)
      .mockResolvedValueOnce({
        key: 'private/v1/aa/aaaaaaaa-1234-4567-89ab-abcdefabcdef.bin',
        encryptedSizeBytes: 128,
      })
      .mockResolvedValueOnce({
        key: 'private/v1/bb/bbbbbbbb-1234-4567-89ab-abcdefabcdef.bin',
        encryptedSizeBytes: 128,
      })
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await expect(
      service.uploadContractGroup({
        sellerId: 'seller-1',
        files: [
          { fileName: 'sayfa-1.pdf', mimeType: 'application/pdf', bytes: pdfBytes('one') },
          { fileName: 'sayfa-2.pdf', mimeType: 'application/pdf', bytes: pdfBytes('two') },
        ],
      }),
    ).rejects.toThrow('database unavailable')
    expect(storage.delete).toHaveBeenCalledTimes(2)
    expect(storage.delete).toHaveBeenCalledWith(
      'private/v1/aa/aaaaaaaa-1234-4567-89ab-abcdefabcdef.bin',
    )
    expect(storage.delete).toHaveBeenCalledWith(
      'private/v1/bb/bbbbbbbb-1234-4567-89ab-abcdefabcdef.bin',
    )
  })

  it('approves every file in a complete contract group with one audited decision', async () => {
    const groupId = 'contract-group-1'
    const documents = [
      makeDocument({
        id: 'contract-1',
        type: 'contract',
        identityPart: null,
        uploadGroupId: groupId,
        uploadOrder: 0,
        uploadGroupSize: 2,
      }),
      makeDocument({
        id: 'contract-2',
        type: 'contract',
        identityPart: null,
        uploadGroupId: groupId,
        uploadOrder: 1,
        uploadGroupSize: 2,
      }),
    ]
    const { prisma, docs, createdAuditLogs } = createPrismaMock(documents)
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await service.reviewContractGroup({
      uploadGroupId: groupId,
      adminId: 'admin-1',
      decision: 'approved',
    })

    expect(storage.read).toHaveBeenCalledTimes(2)
    expect(docs.get('contract-1')?.status).toBe('approved')
    expect(docs.get('contract-2')?.status).toBe('approved')
    expect(createdAuditLogs).toEqual([
      expect.objectContaining({
        actionType: 'seller_document_approved',
        targetType: 'SellerDocumentGroup',
        targetId: groupId,
      }),
    ])
  })

  it('rejects a complete contract group with one required reason', async () => {
    const groupId = 'contract-group-1'
    const document = makeDocument({
      type: 'contract',
      identityPart: null,
      uploadGroupId: groupId,
      uploadOrder: 0,
      uploadGroupSize: 1,
    })
    const { prisma, docs } = createPrismaMock([document])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(
      service.reviewContractGroup({
        uploadGroupId: groupId,
        adminId: 'admin-1',
        decision: 'rejected',
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    await service.reviewContractGroup({
      uploadGroupId: groupId,
      adminId: 'admin-1',
      decision: 'rejected',
      note: 'İmza sayfası okunamıyor',
    })
    expect(docs.get('doc-1')).toMatchObject({
      status: 'rejected',
      adminNote: 'İmza sayfası okunamıyor',
    })
  })

  it('deletes every pending record and encrypted file in a contract group', async () => {
    const groupId = 'contract-group-1'
    const documents = [
      makeDocument({
        id: 'contract-1',
        type: 'contract',
        identityPart: null,
        uploadGroupId: groupId,
        uploadOrder: 0,
        uploadGroupSize: 2,
      }),
      makeDocument({
        id: 'contract-2',
        type: 'contract',
        identityPart: null,
        uploadGroupId: groupId,
        uploadOrder: 1,
        uploadGroupSize: 2,
      }),
    ]
    const { prisma, docs } = createPrismaMock(documents)
    const service = createSellerDocumentService({ prisma: prisma as never, storage })

    await service.deleteContractGroup(groupId, 'seller-1')

    expect(docs.size).toBe(0)
    expect(storage.delete).toHaveBeenCalledTimes(2)
  })

  it.each([
    {
      existingPart: 'front',
      requestedPart: 'combined',
    },
    {
      existingPart: 'combined',
      requestedPart: 'front',
    },
    {
      existingPart: 'back',
      requestedPart: 'back',
    },
  ] as const)(
    'rejects identity slot conflict: $existingPart then $requestedPart',
    async ({ existingPart, requestedPart }) => {
      const existing = makeDocument({ identityPart: existingPart })
      const { prisma } = createPrismaMock([existing])
      const service = createSellerDocumentService({
        prisma: prisma as never,
        storage,
      })

      await expect(
        service.uploadDocument({
          sellerId: 'seller-1',
          type: 'identity' as never,
          identityPart: requestedPart as never,
          fileName: 'kimlik.pdf',
          mimeType: 'application/pdf',
          bytes: pdfBytes(),
        }),
      ).rejects.toBeInstanceOf(ValidationError)

      expect(storage.write).not.toHaveBeenCalled()
    },
  )

  it('allows a rejected identity slot to be uploaded again', async () => {
    const rejected = makeDocument({
      status: 'rejected',
      identityPart: 'front',
    })
    const { prisma, docs } = createPrismaMock([rejected])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await service.uploadDocument({
      sellerId: 'seller-1',
      type: 'identity' as never,
      identityPart: 'front' as never,
      fileName: 'kimlik-on-yeni.pdf',
      mimeType: 'application/pdf',
      bytes: pdfBytes(),
    })

    expect(docs.get('doc-created')).toMatchObject({ identityPart: 'front' })
  })

  it('rejects identity parts on non-identity document types', async () => {
    const { prisma } = createPrismaMock()
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(
      service.uploadDocument({
        sellerId: 'seller-1',
        type: 'tax_certificate' as never,
        identityPart: 'front' as never,
        fileName: 'vergi.pdf',
        mimeType: 'application/pdf',
        bytes: pdfBytes(),
      }),
    ).rejects.toBeInstanceOf(ValidationError)

    expect(storage.write).not.toHaveBeenCalled()
  })

  it('marks legacy R2 records as unavailable and requiring reupload', async () => {
    const privateDocument = makeDocument()
    const legacyDocument = makeLegacyDocument({
      id: 'doc-legacy',
      type: 'tax_certificate',
    })
    const { prisma } = createPrismaMock([privateDocument, legacyDocument])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.listDocuments('seller-1')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'doc-1',
          requiresReupload: false,
          fileAvailable: true,
        }),
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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.readDocumentFile('doc-1')).resolves.toEqual({
      document,
      bytes: Buffer.from('decrypted document'),
    })
    expect(storage.read).toHaveBeenCalledWith(document.fileKey)
  })

  it('fails closed when a legacy R2 document is read or checked', async () => {
    const { prisma } = createPrismaMock([makeLegacyDocument()])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await service.deleteDocument('doc-1', 'seller-1')

    expect(storage.delete).toHaveBeenCalledWith(document.fileKey)
    expect(prisma.sellerDocument.delete).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
    })
    expect(docs.has('doc-1')).toBe(false)
  })

  it('keeps the database record when encrypted byte deletion fails', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.delete).mockRejectedValueOnce(new Error('volume unavailable'))
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toThrow('volume unavailable')

    expect(prisma.sellerDocument.delete).not.toHaveBeenCalled()
    expect(docs.has('doc-1')).toBe(true)
  })

  it('blocks deleting another seller document', async () => {
    const { prisma } = createPrismaMock([makeDocument({ sellerId: 'seller-2' })])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(ForbiddenError)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('blocks deleting non-pending documents', async () => {
    const { prisma } = createPrismaMock([makeDocument({ status: 'approved' })])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.deleteDocument('doc-1', 'seller-1')).rejects.toBeInstanceOf(
      ValidationError,
    )
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('removes an orphan record when compatibility confirmation finds no private file', async () => {
    const { prisma, docs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.exists).mockResolvedValueOnce(false)
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.confirmUpload('doc-1', 'seller-1')).rejects.toBeInstanceOf(ValidationError)

    expect(docs.has('doc-1')).toBe(false)
  })

  it('does not confirm or delete a legacy record through private storage', async () => {
    const { prisma, docs } = createPrismaMock([makeLegacyDocument()])
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

    await expect(service.confirmUpload('doc-1', 'seller-1')).rejects.toMatchObject({
      message: LEGACY_DOCUMENT_REUPLOAD_MESSAGE,
    })

    expect(storage.exists).not.toHaveBeenCalled()
    expect(docs.has('doc-1')).toBe(true)
  })

  it('requires private bytes to decrypt before approval', async () => {
    const { prisma, docs, createdAuditLogs } = createPrismaMock([makeDocument()])
    vi.mocked(storage.read).mockRejectedValueOnce(new Error('authentication failed'))
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
    const service = createSellerDocumentService({
      prisma: prisma as never,
      storage,
    })

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
