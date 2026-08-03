import { NextResponse, type NextRequest } from 'next/server'
import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerDocumentService } from '@hanuja/api/services/seller-document.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'
import { DomainError } from '@hanuja/api/lib/errors'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

interface RouteParams {
  params: Promise<{ groupId: string }>
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError

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

  const { groupId } = await params
  try {
    const service = createSellerDocumentService({ prisma })
    await service.deleteContractGroup(groupId, seller.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ message: 'Sözleşme silinemedi.' }, { status: 500 })
  }
}
