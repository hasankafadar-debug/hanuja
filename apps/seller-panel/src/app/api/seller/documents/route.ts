/**
 * GET  /api/seller/documents — satıcının yüklediği belgeleri listeler
 * POST /api/seller/documents — belge yükleme için presigned URL ister
 *
 * POST body: { type, fileName, mimeType, sizeBytes }
 * POST response: { documentId, uploadUrl, expiresIn }
 *
 * Satıcı yüklemeyi tamamladıktan sonra /api/seller/documents/[id]/confirm çağrılmalıdır.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import type { SellerDocumentType } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

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

export async function GET(request: NextRequest) {
  void request
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!seller) {
    return NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  const service = createSellerDocumentService({ prisma })
  const documents = await service.listDocuments(seller.id)
  return NextResponse.json({ documents })
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
        where: { status: { in: ['pending', 'approved'] } },
        select: { type: true },
      },
    },
  })
  if (!seller) {
    return NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  let body: {
    type: string
    fileName: string
    mimeType: string
    sizeBytes: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }

  const { type, fileName, mimeType, sizeBytes } = body

  if (!type || !VALID_TYPES.includes(type as SellerDocumentType)) {
    return NextResponse.json({ message: 'Geçersiz belge türü.' }, { status: 400 })
  }
  if (!fileName || !mimeType || !sizeBytes) {
    return NextResponse.json(
      { message: 'fileName, mimeType ve sizeBytes zorunludur.' },
      { status: 400 },
    )
  }

  // Pending applicants may only upload the document types explicitly requested by
  // an administrator. A pending/approved upload already satisfies that slot;
  // rejected documents intentionally do not, so the seller can resubmit them.
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

    if (seller.documents.some((document) => document.type === type)) {
      return NextResponse.json(
        {
          message: 'Bu belge türü için incelenen veya onaylanan bir yüklemeniz zaten var.',
        },
        { status: 409 },
      )
    }
  }

  try {
    const service = createSellerDocumentService({ prisma })
    const { document, uploadUrl, expiresIn } = await service.requestUploadUrl({
      sellerId: seller.id,
      type: type as SellerDocumentType,
      fileName,
      mimeType,
      sizeBytes,
    })
    return NextResponse.json({ documentId: document.id, uploadUrl, expiresIn }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata.'
    return NextResponse.json({ message }, { status: 400 })
  }
}
