/**
 * GET /api/admin/documents/[id]/file
 *
 * Private KYC file access for administrators. Files remain on the encrypted
 * application volume and are not backed by public CDN URLs.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams {
  params: Promise<{ id: string }>
}

function contentDisposition(fileName: string, download: boolean) {
  const safeName = fileName.replace(/[\r\n"]/g, '_')
  return `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
} as const

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json(
      { message: 'Yetkisiz erişim.' },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    )
  }

  const { id } = await params
  const download = request.nextUrl.searchParams.get('download') === '1'
  try {
    const service = createSellerDocumentService({ prisma })
    const { document, bytes } = await service.readDocumentFile(id)
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return new NextResponse(body, {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Disposition': contentDisposition(document.fileName, download),
        'Content-Length': String(bytes.byteLength),
        ...PRIVATE_RESPONSE_HEADERS,
      },
    })
  } catch (error) {
    console.error('Admin seller document read failed', {
      documentId: id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return NextResponse.json(
      { message: 'Belge şu anda görüntülenemiyor.' },
      { status: 404, headers: PRIVATE_RESPONSE_HEADERS },
    )
  }
}
