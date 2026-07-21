/**
 * GET /api/seller/documents/[id]/file
 *
 * Authenticated seller-only access to a private KYC file. The document is
 * decrypted in-process and is never exposed via a public storage URL.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams {
  params: Promise<{ id: string }>
}

function contentDisposition(fileName: string) {
  const safeName = fileName.replace(/[\r\n"]/g, '_')
  return `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
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

  const { id } = await params
  const ownedDocument = await prisma.sellerDocument.findFirst({
    where: { id, sellerId: seller.id },
    select: { id: true },
  })
  if (!ownedDocument) {
    return NextResponse.json({ message: 'Belge bulunamadÄ±.' }, { status: 404 })
  }

  try {
    const service = createSellerDocumentService({ prisma })
    const { document, bytes } = await service.readDocumentFile(id)
    if (document.sellerId !== seller.id) {
      return NextResponse.json({ message: 'Bu belgeye erişim yetkiniz yok.' }, { status: 403 })
    }

    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return new NextResponse(body, {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Disposition': contentDisposition(document.fileName),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ message: 'Belge şu anda görüntülenemiyor.' }, { status: 404 })
  }
}
