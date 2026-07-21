/**
 * GET /api/admin/documents/[id]/file
 *
 * Private KYC file access for administrators. Files remain on the encrypted
 * application volume and are not backed by public CDN URLs.
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
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ message: 'Yetkisiz erişim.' }, { status: 403 })
  }

  const { id } = await params
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
        'Content-Disposition': contentDisposition(document.fileName),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ message: 'Belge şu anda görüntülenemiyor.' }, { status: 404 })
  }
}
