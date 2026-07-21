/**
 * GET  /api/seller/documents — seller document list
 * POST /api/seller/documents — upload a KYC document to the server-side private store
 *
 * POST body: multipart/form-data { type, file }
 * POST response: { document }
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import {
  PrismaClient,
  type SellerDocumentIdentityPart,
  type SellerDocumentType,
} from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DomainError } from '@hanuja/api/lib/errors'
import { isPrivateDocumentStorageKey } from '@hanuja/api/lib/private-document-storage'

export const runtime = 'nodejs'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const VALID_TYPES: SellerDocumentType[] = [
  'identity',
  'tax_certificate',
  'trade_registry',
  'signature_circular',
  'bank_statement',
  'other',
]
const VALID_IDENTITY_PARTS: SellerDocumentIdentityPart[] = ['combined', 'front', 'back']
const MAX_MULTIPART_REQUEST_BYTES = 21 * 1024 * 1024

async function readBoundedFormData(request: NextRequest): Promise<FormData> {
  if (!request.body) throw new Error('missing-body')

  const reader = request.body.getReader()
  let received = 0
  let tooLarge = false
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }

      received += value.byteLength
      if (received > MAX_MULTIPART_REQUEST_BYTES) {
        tooLarge = true
        await reader.cancel()
        controller.error(new Error('request-too-large'))
        return
      }
      controller.enqueue(value)
    },
    async cancel() {
      await reader.cancel()
    },
  })

  try {
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: boundedBody,
      // Node's Request implementation requires duplex for a streaming body.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    return await boundedRequest.formData()
  } catch (error) {
    if (tooLarge || (error instanceof Error && error.message === 'request-too-large')) {
      throw new Error('request-too-large')
    }
    throw error
  }
}

function toSellerDocumentResponse(document: {
  id: string
  type: SellerDocumentType
  identityPart: SellerDocumentIdentityPart | null
  status: string
  fileName: string
  mimeType: string
  sizeBytes: number
  adminNote: string | null
  createdAt: Date
  fileKey?: string
  requiresReupload?: boolean
  fileAvailable?: boolean
}) {
  const requiresReupload =
    document.requiresReupload ?? !isPrivateDocumentStorageKey(document.fileKey ?? '')
  return {
    id: document.id,
    type: document.type,
    identityPart: document.identityPart,
    status: document.status,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    adminNote: document.adminNote,
    createdAt: document.createdAt,
    fileUrl: `/api/seller/documents/${document.id}/file`,
    requiresReupload,
    fileAvailable: document.fileAvailable ?? !requiresReupload,
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return (
    value !== null &&
    typeof value !== 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.arrayBuffer === 'function'
  )
}

async function authenticatedSeller() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: 'unauthorized' as const }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      status: true,
      requiredDocumentTypes: true,
      documents: {
        where: { status: { in: ['pending', 'approved'] } },
        select: { type: true, identityPart: true, fileKey: true },
      },
    },
  })
  if (!seller) return { error: 'not-found' as const }
  return { seller }
}

export async function GET(_request: NextRequest) {
  const result = await authenticatedSeller()
  if ('error' in result) {
    return result.error === 'unauthorized'
      ? NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
      : NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const service = createSellerDocumentService({ prisma })
  const documents = await service.listDocuments(result.seller.id)
  return NextResponse.json({ documents: documents.map(toSellerDocumentResponse) })
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError

  const result = await authenticatedSeller()
  if ('error' in result) {
    return result.error === 'unauthorized'
      ? NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
      : NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }
  const { seller } = result

  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_REQUEST_BYTES) {
    return NextResponse.json({ message: 'Dosya boyutu 20 MB limitini aşıyor.' }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await readBoundedFormData(request)
  } catch (error) {
    if (error instanceof Error && error.message === 'request-too-large') {
      return NextResponse.json({ message: 'Dosya boyutu 20 MB limitini aşıyor.' }, { status: 413 })
    }
    return NextResponse.json({ message: 'Geçersiz form verisi.' }, { status: 400 })
  }

  const type = formData.get('type')
  const rawIdentityPart = formData.get('identityPart')
  const file = formData.get('file')
  if (typeof type !== 'string' || !VALID_TYPES.includes(type as SellerDocumentType)) {
    return NextResponse.json({ message: 'Geçersiz belge türü.' }, { status: 400 })
  }
  if (!isUploadedFile(file)) {
    return NextResponse.json({ message: 'Belge dosyası zorunludur.' }, { status: 400 })
  }
  const identityPart =
    type === 'identity' && rawIdentityPart == null
      ? 'combined'
      : typeof rawIdentityPart === 'string' &&
          VALID_IDENTITY_PARTS.includes(rawIdentityPart as SellerDocumentIdentityPart)
        ? (rawIdentityPart as SellerDocumentIdentityPart)
        : null
  if (type === 'identity' && identityPart === null) {
    return NextResponse.json({ message: 'Geçersiz kimlik parçası.' }, { status: 400 })
  }
  if (type !== 'identity' && rawIdentityPart != null) {
    return NextResponse.json(
      { message: 'Kimlik parçası yalnızca kimlik belgesi için seçilebilir.' },
      { status: 400 },
    )
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ message: 'Dosya boyutu 20 MB limitini aşıyor.' }, { status: 413 })
  }

  // Pending applicants may only upload types explicitly requested by an admin.
  // Rejected predecessors are excluded from the query, allowing a resubmission.
  if (seller.status === 'pending') {
    const requestedTypes = Array.isArray(seller.requiredDocumentTypes)
      ? seller.requiredDocumentTypes.map(String)
      : []

    if (!requestedTypes.includes(type)) {
      return NextResponse.json(
        { message: 'Bu belge türü başvurunuz için talep edilmedi.' },
        { status: 403 },
      )
    }
    const occupiedDocuments = seller.documents.filter(
      (document) => document.type === type && isPrivateDocumentStorageKey(document.fileKey),
    )
    const identitySlotOccupied =
      type === 'identity' &&
      occupiedDocuments.some((document) => {
        const occupiedPart = document.identityPart ?? 'combined'
        return (
          identityPart === 'combined' ||
          occupiedPart === 'combined' ||
          occupiedPart === identityPart
        )
      })
    if ((type !== 'identity' && occupiedDocuments.length > 0) || identitySlotOccupied) {
      return NextResponse.json(
        { message: 'Bu belge türü için incelenen veya onaylanan bir yüklemeniz zaten var.' },
        { status: 409 },
      )
    }
  }

  try {
    const service = createSellerDocumentService({ prisma })
    const document = await service.uploadDocument({
      sellerId: seller.id,
      type: type as SellerDocumentType,
      identityPart,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
    return NextResponse.json({ document: toSellerDocumentResponse(document) }, { status: 201 })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    console.error('Seller document upload failed', error)
    return NextResponse.json(
      { message: 'Belge kaydedilemedi. Lütfen tekrar deneyin.' },
      { status: 500 },
    )
  }
}
