/**
 * DELETE /api/seller/documents/[id]
 *
 * Pending durumdaki belgeleri siler (R2 + DB).
 * Approved/rejected belgeler silinemez.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError
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
    await service.deleteDocument(id, seller.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata.'
    const status = message.includes('yetki') ? 403 : message.includes('bulunamadı') ? 404 : 400
    return NextResponse.json({ message }, { status })
  }
}
