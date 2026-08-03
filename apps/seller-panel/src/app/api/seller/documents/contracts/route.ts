import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  CONTRACT_MAX_TOTAL_SIZE_BYTES,
  createSellerDocumentService,
} from '@hanuja/api/services/seller-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DomainError } from '@hanuja/api/lib/errors'

export const runtime = 'nodejs'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const MAX_MULTIPART_REQUEST_BYTES = CONTRACT_MAX_TOTAL_SIZE_BYTES + 5 * 1024 * 1024

function isUploadedFile(value: FormDataEntryValue): value is File {
  return (
    typeof value !== 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.arrayBuffer === 'function'
  )
}

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

function toResponse(document: {
  id: string
  type: string
  status: string
  fileName: string
  mimeType: string
  sizeBytes: number
  adminNote: string | null
  createdAt: Date
  uploadGroupId: string | null
  uploadOrder: number | null
  uploadGroupSize: number | null
  requiresReupload?: boolean
  fileAvailable?: boolean
}) {
  return {
    id: document.id,
    type: document.type,
    identityPart: null,
    status: document.status,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    adminNote: document.adminNote,
    createdAt: document.createdAt,
    uploadGroupId: document.uploadGroupId,
    uploadOrder: document.uploadOrder,
    uploadGroupSize: document.uploadGroupSize,
    fileUrl: `/api/seller/documents/${document.id}/file`,
    requiresReupload: document.requiresReupload ?? false,
    fileAvailable: document.fileAvailable ?? true,
  }
}

export async function POST(request: NextRequest) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      status: true,
      requiredDocumentTypes: true,
      documents: {
        where: { type: 'contract', status: { in: ['pending', 'approved'] } },
        select: { status: true },
      },
    },
  })
  if (!seller) {
    return NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status === 'pending') {
    const requestedTypes = Array.isArray(seller.requiredDocumentTypes)
      ? seller.requiredDocumentTypes.map(String)
      : []
    if (!requestedTypes.includes('contract')) {
      return NextResponse.json(
        { message: 'Sözleşme başvurunuz için talep edilmedi.' },
        { status: 403 },
      )
    }
    if (seller.documents.length > 0) {
      return NextResponse.json(
        {
          message: 'İncelenen veya onaylanan bir sözleşme yüklemeniz zaten var.',
        },
        { status: 409 },
      )
    }
  }

  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_REQUEST_BYTES) {
    return NextResponse.json(
      { message: 'Sözleşme yüklemesi 100 MB toplam boyut limitini aşıyor.' },
      { status: 413 },
    )
  }

  let formData: FormData
  try {
    formData = await readBoundedFormData(request)
  } catch (error) {
    if (error instanceof Error && error.message === 'request-too-large') {
      return NextResponse.json(
        { message: 'Sözleşme yüklemesi 100 MB toplam boyut limitini aşıyor.' },
        { status: 413 },
      )
    }
    return NextResponse.json({ message: 'Geçersiz form verisi.' }, { status: 400 })
  }

  const files = formData.getAll('files')
  const uploadedFiles = files.filter(isUploadedFile)
  if (uploadedFiles.length !== files.length) {
    return NextResponse.json({ message: 'Geçersiz sözleşme dosyası.' }, { status: 400 })
  }

  try {
    const service = createSellerDocumentService({ prisma })
    const result = await service.uploadContractGroup({
      sellerId: seller.id,
      files: await Promise.all(
        uploadedFiles.map(async (file) => ({
          fileName: file.name,
          mimeType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      ),
    })
    return NextResponse.json(
      { groupId: result.groupId, documents: result.documents.map(toResponse) },
      { status: 201 },
    )
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    console.error('Seller contract upload failed', error)
    return NextResponse.json(
      { message: 'Sözleşme kaydedilemedi. Lütfen tekrar deneyin.' },
      { status: 500 },
    )
  }
}
