import { headers } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { auth } from '@/lib/auth'
import { createSellerBankService } from '@hanuja/api/services/seller-bank.service'
import { checkCsrf } from '@hanuja/api/lib/csrf-check'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }
const prisma = globalForPrisma.prisma ?? new PrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export async function POST(req: NextRequest) {
  const csrfError = checkCsrf(req)
  if (csrfError) return csrfError
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
  }

  const seller = await prisma.seller.findUnique({ where: { userId: session.user.id } })
  if (!seller) {
    return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
  }

  if (seller.status !== 'active') {
    return NextResponse.json(
      { error: 'Banka bilgisi yalnızca aktif satıcı hesabında değiştirilebilir.' },
      { status: 403 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { bankDetailId?: string }
  if (!body.bankDetailId) {
    return NextResponse.json({ error: 'Bekleyen kayıt seçilmedi.' }, { status: 400 })
  }

  try {
    const service = createSellerBankService({ prisma })
    const forwardedFor = req.headers.get('x-forwarded-for')
    await service.cancelPending({
      sellerId: seller.id,
      bankDetailId: body.bankDetailId,
      actorId: session.user.id,
      ip: forwardedFor?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'İptal işlemi başarısız.' },
      { status: 400 },
    )
  }
}
