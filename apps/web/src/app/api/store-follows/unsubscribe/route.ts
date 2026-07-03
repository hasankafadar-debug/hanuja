import { NextRequest, NextResponse } from 'next/server'
import { createPrismaForRoute } from '@hanuja/api/lib/prisma'
import { createStoreFollowService } from '@hanuja/api/services/store-follow.service'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim()
  if (!token) {
    return NextResponse.json({ error: 'Token gerekli.' }, { status: 400 })
  }

  const service = createStoreFollowService({ prisma: createPrismaForRoute() })
  const result = await service.unsubscribeByToken(token)

  if (!result) {
    return NextResponse.json({ error: 'Geçersiz çıkış bağlantısı.' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
