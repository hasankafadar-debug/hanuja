/**
 * POST /api/seller/documents/[id]/confirm
 *
 * R2 upload tamamlandıktan sonra çağrılır.
 * Belge durumunu pending (admin inceleme kuyruğu) olarak işaretler.
 * (Başlangıçta da pending ama bu çağrı dosyanın gerçekten R2'ye ulaştığını teyit eder.)
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { DomainError } from '@hanuja/api/lib/errors'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  void request
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ message: 'Oturum açmanız gerekiyor.' }, { status: 401 })
  }

  const { id } = await params

  const seller = await prisma.seller.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!seller) {
    return NextResponse.json({ message: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  try {
    const service = createSellerDocumentService({ prisma })
    await service.confirmUpload(id, seller.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ message: err.message }, { status: err.statusCode })
    }

    const message = err instanceof Error ? err.message : 'Bilinmeyen hata.'
    return NextResponse.json({ message }, { status: 500 })
  }
}
