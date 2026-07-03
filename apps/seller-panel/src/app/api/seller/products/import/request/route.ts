import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { checkUserRateLimit, API_RATE_LIMIT } from '@hanuja/api/lib/rate-limit'

export async function POST() {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) {
      return NextResponse.json({ error: 'Yetkisiz.' }, { status: 401 })
    }

    const rl = await checkUserRateLimit(session.user.id, 'products:import-request', API_RATE_LIMIT)
    if (!rl.allowed) return rl.response!

    const prisma = createPrismaForRoute()
    const seller = await prisma.seller.findUnique({
      where: { userId: session.user.id },
      select: {
        id: true,
        status: true,
        importEnabled: true,
        importRequestedAt: true,
      },
    })

    if (!seller) {
      return NextResponse.json({ error: 'Satıcı hesabı bulunamadı.' }, { status: 404 })
    }

    if (seller.status !== 'active') {
      return NextResponse.json(
        { error: 'İzin isteyebilmek için satıcı hesabınız aktif olmalı.' },
        { status: 403 },
      )
    }

    if (seller.importEnabled) {
      return NextResponse.json(
        { error: 'Import izniniz zaten aktif.' },
        { status: 400 },
      )
    }

    if (seller.importRequestedAt) {
      return NextResponse.json(
        { error: 'Import izin isteğiniz zaten inceleniyor.' },
        { status: 400 },
      )
    }

    await prisma.seller.update({
      where: { id: seller.id },
      data: { importRequestedAt: new Date() },
    })

    return NextResponse.json({ requested: true })
  } catch (err) {
    console.error('[import/request]', err)
    return NextResponse.json(
      { error: 'Sunucu hatası — yöneticinizle iletişime geçin.' },
      { status: 500 },
    )
  }
}
