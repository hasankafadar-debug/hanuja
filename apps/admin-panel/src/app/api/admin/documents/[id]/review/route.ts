/**
 * POST /api/admin/documents/[id]/review
 *
 * Admin KYC belge onay/ret işlemi.
 *
 * Body: { decision: 'approved' | 'rejected', note?: string }
 * - 'rejected' için note zorunludur.
 *
 * Her karar audit log'a yazılır.
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

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const csrfError = checkCsrf(request)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || session.user.role !== 'admin') {
    return NextResponse.json({ message: 'Yetkisiz erişim.' }, { status: 403 })
  }

  const { id: documentId } = await params

  let body: { decision: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: 'Geçersiz istek.' }, { status: 400 })
  }

  const { decision, note } = body

  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json(
      { message: "decision 'approved' veya 'rejected' olmalıdır." },
      { status: 400 },
    )
  }

  try {
    const service = createSellerDocumentService({ prisma })
    await service.reviewDocument({
      documentId,
      adminId: session.user.id,
      decision,
      ...(note?.trim() ? { note: note.trim() } : {}),
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Bilinmeyen hata.'
    const status = message.includes('bulunamadı') ? 404 : 400
    return NextResponse.json({ message }, { status })
  }
}
