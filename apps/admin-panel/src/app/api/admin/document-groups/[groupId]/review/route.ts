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

export async function POST(request: NextRequest, { params }: RouteParams) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ message: 'Yetkisiz erişim.' }, { status: 403 })
  }

  let body: { decision?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }
  if (body.decision !== 'approved' && body.decision !== 'rejected') {
    return NextResponse.json(
      { message: "decision 'approved' veya 'rejected' olmalıdır." },
      { status: 400 },
    )
  }

  const { groupId } = await params
  try {
    const service = createSellerDocumentService({ prisma })
    await service.reviewContractGroup({
      uploadGroupId: groupId,
      adminId: session.user.id,
      decision: body.decision,
      ...(body.note?.trim() ? { note: body.note.trim() } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ message: 'İnceleme kaydedilemedi.' }, { status: 500 })
  }
}
