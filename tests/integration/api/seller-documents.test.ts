import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSessionMock, storageReadMock, storageExistsMock, storageDeleteMock, storageWriteMock } =
  vi.hoisted(() => ({
    getSessionMock: vi.fn(),
    storageReadMock: vi.fn(),
    storageExistsMock: vi.fn(),
    storageDeleteMock: vi.fn(),
    storageWriteMock: vi.fn(),
  }))

let prismaMock: Record<string, unknown>

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: class {
    constructor() {
      return prismaMock
    }
  },
}))

vi.mock('../../../api/lib/private-document-storage', () => ({
  createPrivateDocumentStorage: vi.fn(() => ({
    write: storageWriteMock,
    read: storageReadMock,
    exists: storageExistsMock,
    delete: storageDeleteMock,
  })),
  isPrivateDocumentStorageKey: (fileKey: string) => fileKey.startsWith('private/v1/'),
}))

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
  createdAt: Date
  updatedAt: Date
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

function createPrismaMock(opts?: {
  seller?: { id: string } | null
  documents?: SellerDocumentRecord[]
}) {
  const seller = opts?.seller ?? { id: 'seller-1' }
  const docs = new Map((opts?.documents ?? []).map((doc) => [doc.id, { ...doc }]))
  const createdAuditLogs: Array<Record<string, unknown>> = []

  const prisma = {
    seller: {
      findUnique: vi.fn(async () => seller),
    },
    sellerDocument: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => docs.get(where.id) ?? null),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const current = docs.get(where.id)
          if (!current) throw new Error(`Missing sellerDocument ${where.id}`)
          const updated = { ...current, ...data } as SellerDocumentRecord
          docs.set(where.id, updated)
          return updated
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const current = docs.get(where.id) ?? null
        if (current) docs.delete(where.id)
        return current
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

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  delete (globalThis as { prisma?: unknown }).prisma

  prismaMock = createPrismaMock({
    documents: [makeDocument()],
  }).prisma

  getSessionMock.mockResolvedValue({
    user: {
      id: 'user-1',
      role: 'seller',
    },
  })
  storageReadMock.mockResolvedValue(Buffer.from('%PDF-1.7\nprivate document'))
  storageExistsMock.mockResolvedValue(true)
  storageDeleteMock.mockResolvedValue(undefined)
  storageWriteMock.mockResolvedValue({
    key: 'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    encryptedSizeBytes: 128,
  })
})

describe('Seller document API routes', () => {
  it('returns 200 for successful seller upload confirmation', async () => {
    const { prisma, docs } = createPrismaMock({
      documents: [makeDocument()],
    })
    prismaMock = prisma
    const route =
      await import('../../../apps/seller-panel/src/app/api/seller/documents/[id]/confirm/route.ts')

    const response = await route.POST({} as never, {
      params: Promise.resolve({ id: 'doc-1' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(storageExistsMock).toHaveBeenCalledWith(
      'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    )
    expect(docs.get('doc-1')?.updatedAt).toBeInstanceOf(Date)
  })

  it('returns 422 and cleans up the orphan record when upload confirmation cannot find the private file', async () => {
    const { prisma, docs } = createPrismaMock({
      documents: [makeDocument()],
    })
    prismaMock = prisma
    storageExistsMock.mockResolvedValue(false)
    const route =
      await import('../../../apps/seller-panel/src/app/api/seller/documents/[id]/confirm/route.ts')

    const response = await route.POST({} as never, {
      params: Promise.resolve({ id: 'doc-1' }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      message: 'Dosya yüklemesi doğrulanamadı. Lütfen tekrar deneyin.',
    })
    expect(docs.has('doc-1')).toBe(false)
  })

  it('returns 200 for admin approval review requests', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock({
      documents: [makeDocument()],
    })
    prismaMock = prisma
    getSessionMock.mockResolvedValue({
      user: {
        id: 'admin-1',
        role: 'admin',
      },
    })
    const route =
      await import('../../../apps/admin-panel/src/app/api/admin/documents/[id]/review/route.ts')

    const response = await route.POST(
      new Request('http://localhost/api/admin/documents/doc-1/review', {
        method: 'POST',
        body: JSON.stringify({ decision: 'approved' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ id: 'doc-1' }) },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(docs.get('doc-1')).toMatchObject({
      status: 'approved',
      reviewedBy: 'admin-1',
    })
    expect(createdAuditLogs[0]).toMatchObject({
      actionType: 'seller_document_approved',
    })
    expect(storageReadMock).toHaveBeenCalledWith(
      'private/v1/ab/abcdefab-1234-4567-89ab-abcdefabcdef.bin',
    )
  })

  it('returns 200 for admin rejection review requests with note', async () => {
    const { prisma, createdAuditLogs, docs } = createPrismaMock({
      documents: [makeDocument()],
    })
    prismaMock = prisma
    getSessionMock.mockResolvedValue({
      user: {
        id: 'admin-1',
        role: 'admin',
      },
    })
    const route =
      await import('../../../apps/admin-panel/src/app/api/admin/documents/[id]/review/route.ts')

    const response = await route.POST(
      new Request('http://localhost/api/admin/documents/doc-1/review', {
        method: 'POST',
        body: JSON.stringify({ decision: 'rejected', note: '  Belge okunamıyor  ' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ id: 'doc-1' }) },
    )

    expect(response.status).toBe(200)
    expect(docs.get('doc-1')).toMatchObject({
      status: 'rejected',
      adminNote: 'Belge okunamıyor',
    })
    expect(createdAuditLogs[0]).toMatchObject({
      actionType: 'seller_document_rejected',
      reason: 'Belge okunamıyor',
    })
  })

  it('returns 400 for admin rejection review requests without note', async () => {
    const { prisma } = createPrismaMock({
      documents: [makeDocument()],
    })
    prismaMock = prisma
    getSessionMock.mockResolvedValue({
      user: {
        id: 'admin-1',
        role: 'admin',
      },
    })
    const route =
      await import('../../../apps/admin-panel/src/app/api/admin/documents/[id]/review/route.ts')

    const response = await route.POST(
      new Request('http://localhost/api/admin/documents/doc-1/review', {
        method: 'POST',
        body: JSON.stringify({ decision: 'rejected' }),
        headers: { 'Content-Type': 'application/json' },
      }) as never,
      { params: Promise.resolve({ id: 'doc-1' }) },
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      message: 'Ret kararında gerekçe zorunludur.',
    })
  })
})
