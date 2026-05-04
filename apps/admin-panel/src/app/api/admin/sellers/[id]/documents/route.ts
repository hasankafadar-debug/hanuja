/**
 * GET /api/admin/sellers/[id]/documents
 *
 * Belirli satıcının tüm KYC belgelerini admin için listeler.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteParams) {
  void request
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ message: 'Yetkisiz erişim.' }, { status: 403 })
  }

  const { id: sellerId } = await params

  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { id: true },
  })
  if (!seller) {
    return NextResponse.json({ message: 'Satıcı bulunamadı.' }, { status: 404 })
  }

  const service = createSellerDocumentService({ prisma })
  const documents = await service.listDocumentsBySeller(sellerId)
  return NextResponse.json({ documents })
}
